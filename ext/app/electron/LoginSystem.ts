import { GristLoginMiddleware, GristLoginSystem, GristServer, setUserInSession } from "app/server/lib/GristServer";
import { ApiError } from "app/common/ApiError";
import { Request } from "express";
import { UserProfile } from "app/common/LoginSessionAPI";
import cookie from "cookie";
import { expressWrap } from "app/server/lib/expressWrap";
import { getOrgUrl } from "app/server/lib/requestUtils";
import { makeId } from "app/server/lib/idUtils";


export type GristDesktopAuthMode = "strict" | "none" | "mixed";

export function getProfile(): UserProfile {
  // Both variables are guaranteed to be set when this function is invoked,
  // since loadConfig() is called before a GristApp instance is created.
  // If they are not set by the user, default values will be used. See config.ts for details.
  return {
    email: process.env.GRIST_DEFAULT_EMAIL as string,
    name: process.env.GRIST_DEFAULT_USERNAME as string,
  };
}

// Login and logout, redirecting immediately back.  Signup is treated as login,
// no nuance here.
export class ElectronLoginSystem implements GristLoginSystem {

  private static _instance: ElectronLoginSystem;

  private authMode: GristDesktopAuthMode;
  private credential: string;

  private constructor() {
    this.credential = makeId();
    this.authMode = process.env.GRIST_DESKTOP_AUTH as GristDesktopAuthMode;
  }

  public authenticateURL(url: URL) {
    const newUrl = new URL(url);
    if (this.authMode !== "none") {
      newUrl.searchParams.set("electron_key", this.credential);
    }
    return newUrl;
  }

  public static get instance() {
    if (!ElectronLoginSystem._instance) {
      ElectronLoginSystem._instance = new ElectronLoginSystem();
    }
    return ElectronLoginSystem._instance;
  }

  async getMiddleware(gristServer: GristServer) {
    const getLoginRedirectUrl = async (req: Request, url: URL) => {
      if (this.authMode !== 'none' && !(req as any).electronDirect) {
        return getOrgUrl(req) + 'electron_only';
      }
      await setUserInSession(req, gristServer, getProfile());
      return url.href;
    };
    const middleware: GristLoginMiddleware = {
      getLoginRedirectUrl,
      getSignUpRedirectUrl: getLoginRedirectUrl,
      getLogoutRedirectUrl: async (_: Request, url: URL) => {
        return url.href;
      },
      addEndpoints: async (app) => {
        // Make sure default user exists.
        const dbManager = gristServer.getHomeDBManager();
        const profile = getProfile();
        const user = await dbManager.getUserByLoginWithRetry(profile.email, {profile});
        if (user) {
          // No need to survey this user!
          user.isFirstTimeUser = false;
          await user.save();
        }
        app.get('/electron_only', expressWrap(async () => {
          throw new ApiError("Access restricted to Electron user",
            401);
        }));
        return 'electron-login';
      },
      getWildcardMiddleware: () => {
        if (this.authMode === 'none') {
          return [];
        }
        return [expressWrap(async (req, res, next) => {
          const url = new URL("http://localhost" + req.url);
          const keyPresented = url.searchParams.get('electron_key');
          const cookies = cookie.parse(req.headers.cookie || '');
          const keyRemembered = cookies['electron_key'];
          if (!keyPresented && !keyRemembered) {
            (req as any).forbidLogin = true;
          }
          if (keyPresented && keyPresented !== keyRemembered) {
            res.cookie('electron_key', keyPresented);
          }
          if (keyPresented === this.credential || keyRemembered === this.credential) {
            (req as any).electronDirect = true;
          }
          return next();
        })];
      },
    };
    return middleware;
  }

  async deleteUser() {
    // nothing to do
  }
}

/**
 * A bare bones login system specialized for Electron. Single, hard-coded user.
 * By default only user logging in directly through app gets admitted, everyone
 * else is anonymous.
 */
export async function getElectronLoginSystem() {
  return ElectronLoginSystem.instance;
}

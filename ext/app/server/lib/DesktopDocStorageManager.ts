import {
  HostedStorageCallbacks,
  HostedStorageManager,
  HostedStorageOptions} from "app/server/lib/HostedStorageManager";
import {Document} from "app/gen-server/entity/Document";
import {HomeDBManager} from "app/gen-server/lib/homedb/HomeDBManager";
import {fileExists} from "app/electron/fileUtils";
import {IDocWorkerMap} from "app/server/lib/DocWorkerMap";
import {ExternalStorageCreator} from "app/server/lib/ExternalStorage";
import {GristServer} from "app/server/lib/GristServer";
import {IDocStorageManager} from "app/server/lib/IDocStorageManager";
import log from "app/server/lib/log";

export class DesktopDocStorageManager extends HostedStorageManager {
    // Document paths on disk are stored in the HomeDB. However, they need caching here to allow synchronous access,
    // as Grist Core expects IDocStorageManager to provide file paths synchronously, and it would be a huge effort
    // to refactor.
    private _idToPathMap: Map<string, string> = new Map();
    private _pathToIdMap: Map<string, string> = new Map();

    constructor(
        gristServer: GristServer,
        docsRoot: string,
        docWorkerId: string,
        disableS3: boolean,
        docWorkerMap: IDocWorkerMap,
        callbacks: HostedStorageCallbacks,
        createExternalStorage: ExternalStorageCreator,
        options?: HostedStorageOptions
    ) {
      super(gristServer, docsRoot, docWorkerId, disableS3, docWorkerMap, callbacks, createExternalStorage, options);
    }

    getPath(docName: string): string {
        const docPath = this.lookupById(docName);
        log.debug(`DesktopStorageManager fetching cached path for ${docName}: ${docPath}`);
        // Fall back on default path if cache is out of sync.
        return docPath || super.getPath(docName);
    }

    async loadFilePathsFromHomeDB(homeDb: HomeDBManager) {
        for (const doc of await homeDb.getAllDocs()) {
            // Most Grist Desktop documents will have externalId set to their file path.
            // Some won't (e.g created in an older version), so try their default path.
            const docPath = doc.options?.externalId || super.getPath(doc.id);
            if (docPath && fileExists(docPath)) {
                this.registerDocPath(doc.id, docPath);
            }
        }
    };

    async listDocsWithoutFilesInCache(homeDb: HomeDBManager): Promise<Document[]> {
        const allDocs = await homeDb.getAllDocs();
        return allDocs.filter((doc) => !fileExists(this.getPath(doc.id)));
    };

    registerDocPath(docId: string, docPath: string) {
        this._idToPathMap.set(docId, docPath);
        this._pathToIdMap.set(docPath, docId);
    };

    deregisterDocById(docId: string) {
        const docPath = this._idToPathMap.get(docId);
        if (!docPath) { return; }

        this._idToPathMap.delete(docId);
        this._pathToIdMap.delete(docPath);
    }

    deregisterDocByPath(docPath: string) {
        const docId = this._pathToIdMap.get(docPath);
        if (!docId) {
            return;
        }

        this._idToPathMap.delete(docId);
        this._pathToIdMap.delete(docPath);
    }

    public lookupById(docId: string): string | null {
        return this._idToPathMap.get(docId) ?? null;
    }

    public lookupByPath(docPath: string): string | null {
        return this._pathToIdMap.get(docPath) ?? null;
    }

    public getCachedPaths(): [string, string][] {
        return Array.from(this._idToPathMap.entries());
    }
}

export function isDesktopStorageManager(storageManager: IDocStorageManager): storageManager is DesktopDocStorageManager {
    return storageManager instanceof DesktopDocStorageManager;
}

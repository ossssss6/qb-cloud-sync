-- CreateTable
CREATE TABLE "TorrentTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "localPath" TEXT NOT NULL,
    "calculatedRemotePath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_UPLOAD',
    "uploadAttempts" INTEGER NOT NULL DEFAULT 0,
    "verificationAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" DATETIME,
    "errorMessage" TEXT,
    "uploadSize" BIGINT,
    "uploadDurationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "TorrentTask_hash_key" ON "TorrentTask"("hash");

-- CreateIndex
CREATE INDEX "TorrentTask_status_idx" ON "TorrentTask"("status");

-- CreateIndex
CREATE INDEX "TorrentTask_hash_idx" ON "TorrentTask"("hash");

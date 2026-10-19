#!/bin/bash
# Nightly database + media backup. Keeps the last $BACKUP_KEEP_DAYS days.
set -euo pipefail
STAMP=$(date +%Y%m%d-%H%M)
mkdir -p /backups
mongodump --uri="mongodb://mongo:27017/luvall?replicaSet=rs0" --archive="/backups/db-$STAMP.archive.gz" --gzip
tar -czf "/backups/media-$STAMP.tar.gz" -C /media .
find /backups -type f -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
echo "backup $STAMP complete"

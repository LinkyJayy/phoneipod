const path = require('path');

// On Railway, attaching a volume sets RAILWAY_VOLUME_MOUNT_PATH automatically.
const DATA_DIR = path.resolve(
  process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..', 'data')
);

module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  DATA_DIR,
  MEDIA_DIR: path.join(DATA_DIR, 'media'),
  TMP_DIR: path.join(DATA_DIR, 'tmp'),
  DB_FILE: path.join(DATA_DIR, 'phoneipod.db'),
  ALLOW_SIGNUPS: process.env.ALLOW_SIGNUPS !== 'false',
  MAX_UPLOAD_MB: Number(process.env.MAX_UPLOAD_MB) || 300,
  USER_QUOTA_MB: Number(process.env.USER_QUOTA_MB) || 0, // 0 = unlimited
  SESSION_DAYS: Number(process.env.SESSION_DAYS) || 30,
  ON_RAILWAY: !!process.env.RAILWAY_ENVIRONMENT_NAME || !!process.env.RAILWAY_PROJECT_ID,
  HAS_VOLUME: !!(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH),
};

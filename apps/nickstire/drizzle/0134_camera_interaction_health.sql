-- 0134 · role-aware interaction/PTZ camera health
--
-- Fixed vehicle cameras and the movable office camera fail in different ways. A single
-- ONLINE/OFFLINE bit hid a measured partial failure on 2026-09-26: Eufy auth + push were
-- healthy while P2P control and media both timed out. These NULLABLE fields preserve those
-- dimensions without changing the contract of older fixed-geometry producers.
--
-- NULL = not measured / not proven. 0 = measured failure. 1 = measured healthy.
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS authPlaneOk BOOLEAN NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS eventPlaneOk BOOLEAN NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS controlPlaneOk BOOLEAN NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS mediaPlaneOk BOOLEAN NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS ptzHomeOk BOOLEAN NULL;

ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS lastEventProofAt TIMESTAMP NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS lastControlProofAt TIMESTAMP NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS lastMediaProofAt TIMESTAMP NULL;
ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS lastPtzNotifyAt TIMESTAMP NULL;

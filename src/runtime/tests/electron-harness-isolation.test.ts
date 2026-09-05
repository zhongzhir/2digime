import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { launchDigitalMeElectron, officialAppUserDataPath } from './electron-harness';

test('launchDigitalMeElectron 拒绝正式 AppData userData', async () => {
  const official = officialAppUserDataPath();
  assert.match(official, /digitalme-v2$/);
  await assert.rejects(
    () => launchDigitalMeElectron({ userData: official, realProduct: true }),
    /must not use the official AppData/,
  );
  await assert.rejects(
    () =>
      launchDigitalMeElectron({
        userData: path.join(official, 'subjects', 'default'),
        realProduct: true,
      }),
    /must not use the official AppData/,
  );
});

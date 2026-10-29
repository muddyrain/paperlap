import { execFileSync } from "node:child_process";
export const performanceFixtures = JSON.parse(
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `
import {storageFixture} from './tests/fixtures/storage-performance.ts';
import * as v3 from './src/game/save-v3.ts';
import {storageTextDigest} from './src/game/geometry-identity.ts';
const fixtures={};
for(const points of [200,450,900])for(const count of [1,5,20]){
 const old=storageFixture(points,count);
 for(const e of old.tracks)old.records[e.uid+':'+e.track.id+':rules-2']=25;
 const raw=JSON.stringify(old), r=v3.migrateSave(old,'v2',{v1:null,v2:storageTextDigest(raw)});
 if(!r.ok)throw Error(r.error);
 fixtures[points+'-'+count]={'paperlap.save.v2':raw,'paperlap.save.v3':JSON.stringify(r.save)};
}
console.log(JSON.stringify(fixtures));
`,
    ],
    { encoding: "utf8", maxBuffer: 20_000_000 },
  ),
);

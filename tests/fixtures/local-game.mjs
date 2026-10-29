import { execFileSync } from "node:child_process";
export const localGameFixtures = JSON.parse(
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `
import * as old from './src/game/save.ts';
import * as v3 from './src/game/save-v3.ts';
import {storageTextDigest} from './src/game/geometry-identity.ts';
import {localFixtures,ellipseTrack} from './src/prototypes/local-edit-fixtures.ts';
const result={};
for(const [name,track] of [['wide',localFixtures()[0]],['s',localFixtures()[1]],['tight',localFixtures()[2]],...[200,450,900].map(n=>[String(n),ellipseTrack(n)])]){
 const s=old.freshSave();s.tracks[0].track={...track,name:'晨光绕湖·连续弯道局部调整与历史纪录保护的长名称赛道'.repeat(2).slice(0,40)};
 s.records[old.recordKey(s.tracks[0],1)]=20.12;s.records[old.recordKey(s.tracks[0],2)]=24.68;s.legacyRecords['track-beef:rules-1']=31;
 const raw=JSON.stringify(s),v1='old-v1-source-preserve',r=v3.migrateSave(s,'v2',{v1:storageTextDigest(v1),v2:storageTextDigest(raw)});if(!r.ok)throw Error(r.error);
 let save=r.save;
 for(const next of [v3.setBest(save,save.activeTrackUid,8.5)]){if(!next.ok)throw Error(next.error);save=next.save;}
 const b=v3.addTrack(save,{...track,name:'B 对照赛道'},'entry-B');if(!b.ok)throw Error(b.error);save=b.save;
 const best=v3.setBest(save,'entry-B',35);if(!best.ok)throw Error(best.error);
 const selected=v3.selectTrack(best.save,'entry-default');if(!selected.ok)throw Error(selected.error);
 result[name]={'paperlap.save.v1':v1,'paperlap.save.v2':raw,'paperlap.save.v3':JSON.stringify(selected.save),'paperlap.draft.v1':'old-whole-v1-preserve','paperlap.draft.v2':'old-whole-v2-preserve'};
}
console.log(JSON.stringify(result));
`,
    ],
    { encoding: "utf8", maxBuffer: 8_000_000 },
  ),
);

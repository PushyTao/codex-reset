import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
let count=0;
for(const dir of ['server','public','tests','scripts']){
  for(const file of readdirSync(dir).filter(f=>f.endsWith('.js'))){
    const path=join(dir,file);const result=spawnSync(process.execPath,['--check',path],{stdio:'inherit'});
    if(result.status!==0)process.exit(1);count++;
  }
}
console.log(`Syntax OK: ${count} JavaScript files`);

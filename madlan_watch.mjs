import puppeteerCore from "puppeteer-core";
import fs from "fs";
fs.writeFileSync("/tmp/madlan_cap.json",""); fs.writeFileSync("/tmp/madlan_st.txt","watching madlan\n");
const b=await puppeteerCore.connect({browserURL:"http://127.0.0.1:9222", defaultViewport:null});
const attach=p=>p.on("response",async r=>{
  const u=r.url();
  if(/bulldozer|graphql|api2/i.test(u)){
    try{const t=await r.text();
      if(/buildingYear/.test(t) && /(dealDate|soldOn|soldDate|"date"|"sold"|pastSales|"deals")/i.test(t)){
        const op=(r.request().postData()||"").match(/"operationName":"([^"]+)"/); 
        fs.writeFileSync("/tmp/madlan_cap.json",JSON.stringify({url:u.slice(0,80),op:op?op[1]:null,post:(r.request().postData()||"").slice(0,400),body:t.slice(0,4000)},null,1));
        fs.appendFileSync("/tmp/madlan_st.txt",`CAPTURED deals op=${op?op[1]:"?"} len=${t.length}\n`);
      }
    }catch{}
  }
});
for(const p of await b.pages())attach(p);
b.on("targetcreated",async t=>{const p=await t.page().catch(()=>null);if(p)attach(p);});
await new Promise(r=>setTimeout(r,600000));
await b.disconnect();

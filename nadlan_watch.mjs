import puppeteerCore from "puppeteer-core";
import zlib from "zlib";
import fs from "fs";
const dec=(t)=>{if(t.trim().startsWith("{"))return JSON.parse(t);try{return JSON.parse(zlib.gunzipSync(Buffer.from(t,"base64")).toString("utf8"));}catch{return null;}};
fs.writeFileSync("/tmp/nadlan_req.txt","");fs.writeFileSync("/tmp/nadlan_cap.json","");fs.writeFileSync("/tmp/nadlan_st.txt","watching (request+response)\n");
const b=await puppeteerCore.connect({browserURL:"http://127.0.0.1:9222", defaultViewport:null});
const attach=p=>{
  p.on("request",r=>{ if(/\/deal-data/.test(r.url())&&r.method()==="POST"){const body=r.postData()||""; fs.writeFileSync("/tmp/nadlan_req.txt",body); fs.appendFileSync("/tmp/nadlan_st.txt","REQUEST captured len "+body.length+"\n"); }});
  p.on("response",async r=>{ if(/\/deal-data/.test(r.url())){try{const j=dec(await r.text());const it=j?.data?.items||[];const byY={};for(const d of it){const y=(d.dealDate||"").slice(0,4);if(y)byY[y]=(byY[y]||0)+1;} fs.writeFileSync("/tmp/nadlan_cap.json",JSON.stringify({status:r.status(),count:it.length,total_rows:j?.data?.total_rows,years:byY,fields:Object.keys(it[0]||{}),sample:it[0]?{yearBuilt:it[0].yearBuilt,priceSM:it[0].priceSM,dealDate:it[0].dealDate,rooms:it[0].rooms}:null},null,1)); fs.appendFileSync("/tmp/nadlan_st.txt","RESPONSE "+it.length+" items\n"); }catch(e){}}});
};
for(const p of await b.pages())attach(p);
b.on("targetcreated",async t=>{const p=await t.page().catch(()=>null);if(p)attach(p);});
await new Promise(r=>setTimeout(r,600000));
await b.disconnect();

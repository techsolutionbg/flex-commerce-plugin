const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../assets/storefront.js'),'utf8').split('const favouritesKey =')[1];
function harness(storage={value:'[]'}) {
 const events={},attrs={};
 const button={dataset:{commerceFavorite:'3',productName:'Gift'},setAttribute(k,v){attrs[k]=v;}};
 const badge={hidden:true,textContent:''}, link={setAttribute(k,v){this[k]=v;}};
 const document={body:{append(){}},createElement(){return {setAttribute(){}};},querySelector(){return null;},querySelectorAll(selector){return selector==='[data-commerce-favorite]'?[button]:selector==='[data-commerce-favourites-count]'?[badge]:selector==='[data-commerce-favourites-link]'?[link]:[];},addEventListener(k,v){if(k==="click") (events.click ||= []).push(v); else events[k]=v;}};
 vm.runInNewContext('const favouritesKey ='+source,{document,URL,location:{href:"http://localhost/catalog",pathname:"/catalog",search:"",hash:""},window:{addEventListener(k,v){events[k]=v;},confirm:()=>true},localStorage:{getItem(){return storage.value;},setItem(k,v){if(storage.fail)throw Error('Unavailable');storage.value=v;}},console,toastSuccess(){},toastError(){},notifySuccess(){},notifyError(){}});
 return {badge,link,button,attrs,events,click(){for(const listener of events.click) listener({target:{closest(selector){return selector==="[data-commerce-favorite]"?button:null;}}});}};
}
test('favourite toggle updates badge immediately and persists across reloads and tabs',()=>{
 const storage={value:'[]'},first=harness(storage);
 first.click(); assert.equal(first.badge.textContent,'1');assert.equal(first.badge.hidden,false);assert.equal(first.attrs['aria-pressed'],'true');assert.equal(first.link['aria-label'],'Любими (1)');
 const reloaded=harness(storage);assert.equal(reloaded.badge.textContent,'1');
 reloaded.click();assert.equal(reloaded.badge.hidden,true);
 first.events.storage({key:'flex-commerce-favourites'});assert.equal(first.badge.hidden,true);
});
test('failed persistence keeps the previous count and favourite state',()=>{
 const first=harness({value:'[]',fail:true});first.click();assert.equal(first.badge.textContent,'0');assert.equal(first.badge.hidden,true);assert.equal(first.attrs['aria-pressed'],'false');
});

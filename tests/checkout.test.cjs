const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
async function harness(respond) {
  const states=[],effects=[],calls=[],focused=[],redirects=[];let cursor=0,Component;
  const React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef(initial){const i=cursor++;if(!(i in states))states[i]={current:initial};return states[i];},useEffect:fn=>effects.push(fn),useSyncExternalStore:()=>({cart:{items:[]},busy:false})};
  global.window={FlexStorefront:{React,register(name,fn){Component=fn;},mount(){},unmount(){}},location:{assign:url=>redirects.push(url)}};
  global.document={querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},removeEventListener(){},visibilityState:'hidden'};
  global.fetch=async(url,options)=>{calls.push({url,...options});return respond(calls.at(-1),calls.length);};
  const source=fs.readFileSync(path.join(__dirname,'../assets/checkout.js'),'utf8')
    .replace(/^import .*?;\r?\n/gm,'')
    .replace(/^/,'const requestCart=async()=>{},subscribeCart=()=>{},getCartSnapshot=()=>{};\nconst createCheckbox=(h)=>function Checkbox(props){return {type:"flex-checkbox",props};};\n');
  await import('data:text/javascript;base64,'+Buffer.from('const setInterval=()=>0;\n'+source+'\n//'+Math.random()).toString('base64'));
  const render=()=>{
    cursor=0;
    const tree=Component();
    const form=all(tree,n=>n.type==='form')[0];
    if(form?.props?.ref){
      form.props.ref.current={querySelector:selector=>({focus:()=>focused.push(selector),type:selector.includes('office')?'hidden':'text'})};
    }
    return tree;
  };
  function all(tree,predicate){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(t=>all(t,predicate));return [...(predicate(tree)?[tree]:[]),...all(tree.props?.children,predicate)];}
  render();for(const effect of effects.splice(0))effect();await new Promise(resolve=>setImmediate(resolve));
  function fill(){const values={first_name:'Иван',last_name:'Иванов',email:'test@example.invalid',phone:'+359888123456',city:'София',postcode:'1000',address:'Улица 1',note:'Запазена бележка',terms:true};for(const node of all(render(),n=>n.props?.name&&Object.hasOwn(values,n.props.name)))node.props.onChange({target:{value:values[node.props.name],checked:true}});}
  return {render,all,calls,focused,redirects,fill};
}
const quote={quote:{items:[{product_id:1,name:'Gift',quantity:2,line_minor:1600}],currency:'EUR',subtotal_minor:1600,shipping_minor:500,total_minor:2100,fingerprint:'price-1',terms_url:'',privacy_url:''},csrf_token:'csrf-test',request_key:'request-test'};
const response=(body,ok=true,status=200)=>({ok,status,json:async()=>body});
test('checkout validates fields and submits the authoritative quote once',async()=>{
 const t=await harness(call=>response(call.method==='POST'?{url:'/order-received'}:quote));
 let form=t.all(t.render(),n=>n.type==='form')[0];await form.props.onSubmit({preventDefault(){}});assert.equal(t.calls.filter(c=>c.method==='POST').length,0);assert.ok(t.focused[0].includes('first_name'));
 t.fill();form=t.all(t.render(),n=>n.type==='form')[0];await Promise.all([form.props.onSubmit({preventDefault(){}}),form.props.onSubmit({preventDefault(){}})]);
 const writes=t.calls.filter(c=>c.method==='POST');assert.equal(writes.length,1);const payload=JSON.parse(writes[0].body);assert.equal(payload.fingerprint,'price-1');assert.equal(payload.payment,'cod');assert.equal(payload.terms,true);assert.equal(writes[0].headers['X-CSRF-Token'],'csrf-test');assert.deepEqual(t.redirects,['/order-received']);
});
test('price conflict refreshes the quote and keeps the entered customer data',async()=>{
 let writes=0;const t=await harness(call=>call.method==='POST'?response({error:{message:'Цената е променена.'}},false,409):response({...quote,quote:{...quote.quote,fingerprint:writes++?'price-2':'price-1'}}));
 t.fill();await t.all(t.render(),n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});
 const tree=t.render();assert.equal(t.all(tree,n=>n.props?.name==='note')[0].props.value,'Запазена бележка');assert.equal(t.all(tree,n=>n.props?.role==='alert')[0].props.children[0],'Цената е променена.');assert.equal(t.redirects.length,0);
 await t.all(tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});assert.equal(JSON.parse(t.calls.filter(c=>c.method==='POST').at(-1).body).fingerprint,'price-2');
});
test('empty cart shows a dedicated empty state without retry',async()=>{
  const t=await harness(()=>response({error:{message:'Количката е празна.'}},false,422));
  const tree=t.render();
  assert.equal(t.all(tree,n=>n.type==='form').length,0);
  assert.ok(t.all(tree,n=>n.type==='h2').some(n=>n.props.children[0]==='Количката е празна'));
  assert.ok(t.all(tree,n=>n.type==='a').some(n=>n.props.href==='/catalog'));
  assert.equal(t.all(tree,n=>n.type==='button').length,0);
});
test('require_login blocks submit and shows a login action',async()=>{
  const t=await harness(()=>response({...quote,accounts:{require_login:true,logged_in:false,login_url:'/account/login?next=%2Fcheckout'}}));
  const tree=t.render();
  assert.ok(t.all(tree,n=>n.props?.className==='commerce-checkout-login-note').length>=1);
  assert.ok(t.all(tree,n=>n.type==='a'&&String(n.props?.children||'').includes('Влезте')).length>=1);
  assert.equal(t.all(tree,n=>n.type==='button'&&n.props?.type==='submit').length,0);
  const form=t.all(tree,n=>n.type==='form')[0];
  t.fill();
  await form.props.onSubmit({preventDefault(){}});
  assert.equal(t.calls.filter(c=>c.method==='POST').length,0);
});
test('office shipping requires an office selection and shows an error',async()=>{
  const officeQuote={...quote,quote:{...quote.quote,shipping:'econt_office',methods:[{id:'econt_office',label:'Еконт — до офис',type:'office'}],shipping_meta:{}}};
  const t=await harness(()=>response(officeQuote));
  t.fill();
  const form=t.all(t.render(),n=>n.type==='form')[0];
  await form.props.onSubmit({preventDefault(){}});
  assert.equal(t.calls.filter(c=>c.method==='POST').length,0);
  const tree=t.render();
  assert.ok(t.all(tree,n=>n.props?.className==='commerce-checkout-office-error').some(n=>String(n.props.children||'').includes('Изберете офис')));
  assert.ok(t.all(tree,n=>n.props&&('data-office-error' in n.props)).some(n=>String(n.props['data-office-error']||'').includes('Изберете офис')));
});
test('address shipping requires city postcode and address',async()=>{
  const addressQuote={...quote,quote:{...quote.quote,shipping:'address',methods:[{id:'address',label:'Доставка до адрес',type:'address'}]}};
  const t=await harness(()=>response(addressQuote));
  t.fill();
  for(const name of ['city','postcode','address']){
    const input=t.all(t.render(),n=>n.props?.name===name)[0];
    input.props.onChange({target:{value:'',checked:false}});
  }
  const form=t.all(t.render(),n=>n.type==='form')[0];
  await form.props.onSubmit({preventDefault(){}});
  assert.equal(t.calls.filter(c=>c.method==='POST').length,0);
  const tree=t.render();
  for(const name of ['city','postcode','address']){
    assert.ok(t.all(tree,n=>n.props?.id==='checkout-'+name+'-error').length>=1, name+' error');
  }
});

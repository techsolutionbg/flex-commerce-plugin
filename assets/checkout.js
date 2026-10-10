import { requestCart, subscribeCart, getCartSnapshot } from './cart.js?v=10';
import { createCheckbox } from './checkbox.js';
const endpoint='/plugins/flex/commerce/checkout/data';
const EMPTY_CART_MESSAGE='Количката е празна.';
function initialize(rt) {
  const {React}=rt, h=React.createElement, Checkbox=createCheckbox(h);
  const amount=(minor,currency)=>new Intl.NumberFormat('bg-BG',{style:'currency',currency}).format(minor/100);
  function methodOf(quote) {
    const id=quote?.shipping||'address';
    return (quote?.methods||[]).find(m=>m.id===id)||{id:'address',label:'Доставка до адрес',type:'address'};
  }
  function CheckoutSkeleton() {
    return h('div',{className:'commerce-checkout-skeleton',role:'status','aria-label':'Зареждане на поръчката'},
      h('div',{className:'commerce-checkout-layout','aria-hidden':true},
        h('div',{className:'commerce-checkout-details'},
          h('div',{className:'commerce-checkout-card commerce-checkout-skeleton-card'},h('span',{className:'commerce-checkout-skeleton-line is-heading'}),h('div',{className:'commerce-checkout-skeleton-fields'},h('span',{className:'commerce-checkout-skeleton-line is-field'}),h('span',{className:'commerce-checkout-skeleton-line is-field'}),h('span',{className:'commerce-checkout-skeleton-line is-field'}),h('span',{className:'commerce-checkout-skeleton-line is-field'}))),
          h('div',{className:'commerce-checkout-card commerce-checkout-skeleton-card'},h('span',{className:'commerce-checkout-skeleton-line is-heading'}),h('div',{className:'commerce-checkout-skeleton-fields'},h('span',{className:'commerce-checkout-skeleton-line is-field'}),h('span',{className:'commerce-checkout-skeleton-line is-field'}),h('span',{className:'commerce-checkout-skeleton-line is-field is-wide'}),h('span',{className:'commerce-checkout-skeleton-line is-field is-wide'}))),
          h('div',{className:'commerce-checkout-card commerce-checkout-skeleton-card'},h('span',{className:'commerce-checkout-skeleton-line is-heading'}),h('span',{className:'commerce-checkout-skeleton-line is-payment'}))),
        h('aside',{className:'commerce-checkout-card commerce-checkout-skeleton-summary'},h('span',{className:'commerce-checkout-skeleton-line is-heading'}),h('span',{className:'commerce-checkout-skeleton-line is-item'}),h('span',{className:'commerce-checkout-skeleton-line is-item'}),h('span',{className:'commerce-checkout-skeleton-line is-total'}),h('span',{className:'commerce-checkout-skeleton-line is-check'}),h('span',{className:'commerce-checkout-skeleton-line is-button'}),h('span',{className:'commerce-checkout-skeleton-line is-link'}))),
      h('span',{className:'visually-hidden'},'Зареждане на поръчката…'));
  }
  function Checkout() {
    const [data,setData]=React.useState(null),[failure,setFailure]=React.useState(''),[busy,setBusy]=React.useState(false),[errors,setErrors]=React.useState({});
    const [fields,setFields]=React.useState({first_name:'',last_name:'',email:'',phone:'',city:'',postcode:'',address:'',note:'',terms:false});
    const [shipping,setShipping]=React.useState('address');
    const [shippingMeta,setShippingMeta]=React.useState({});
    const cart=React.useSyncExternalStore(subscribeCart,getCartSnapshot);
    const formRef=React.useRef(null), sending=React.useRef(false), generation=React.useRef(0);
    const shippingPrefillApplied=React.useRef(false);
    const shippingRef=React.useRef(shipping), shippingMetaRef=React.useRef(shippingMeta), fieldsRef=React.useRef(fields);
    shippingRef.current=shipping; shippingMetaRef.current=shippingMeta; fieldsRef.current=fields;
    const quote=data?.quote;
    const accounts=data?.accounts&&typeof data.accounts==='object'?data.accounts:null;
    const needsLogin=!!(accounts?.require_login&&!accounts?.logged_in);
    const loginUrl=accounts?.login_url||('/account/login?next='+encodeURIComponent('/checkout'));
    const method=methodOf(quote);
    const methods=quote?.methods||[{id:'address',label:'Доставка до адрес',type:'address'}];
    const emptyCart=failure===EMPTY_CART_MESSAGE;
    const loading=!quote&&!failure;
    React.useEffect(()=>{
      const root=document.querySelector('[data-commerce-checkout][data-flex-react-mounted]');
      if(root) root.setAttribute('aria-busy', loading?'true':'false');
    },[loading]);
    async function refresh(nextShipping=shippingRef.current, nextMeta=shippingMetaRef.current, nextFields=fieldsRef.current) {
      const version=++generation.current;
      try {
        const merged={...nextMeta};
        if(nextFields.city) merged.city=nextFields.city.trim();
        if(nextFields.postcode) merged.postcode=nextFields.postcode.trim();
        if(nextFields.address) merged.address=nextFields.address.trim();
        const params=new URLSearchParams();
        if(nextShipping) params.set('shipping', nextShipping);
        if(Object.keys(merged).length) params.set('shipping_meta', JSON.stringify(merged));
        if(merged.office_code) params.set('office_code', String(merged.office_code));
        const url=params.toString()?endpoint+'?'+params:endpoint;
        const response=await fetch(url,{headers:{Accept:'application/json'},cache:'no-store',credentials:'same-origin'});
        const result=await response.json(); if(version!==generation.current)return;
        if(!response.ok)throw new Error(result.error?.message||'Поръчката не може да бъде заредена.');
        setData(result);setFailure('');
        if(result.quote?.shipping) setShipping(result.quote.shipping);
        if(result.quote?.shipping_meta&&typeof result.quote.shipping_meta==='object') {
          setShippingMeta({...merged,...result.quote.shipping_meta});
        }
        const prefill=result.customer_prefill;
        if(prefill&&typeof prefill==='object'){
          setFields(current=>{
            const next={...current};
            for(const key of ['first_name','last_name','email','phone']){
              if(!String(current[key]||'').trim()&&typeof prefill[key]==='string'&&prefill[key].trim()) next[key]=prefill[key];
            }
            return next;
          });
        }
        const shippingPrefill=result.shipping_prefill;
        if(!shippingPrefillApplied.current&&shippingPrefill&&typeof shippingPrefill==='object'){
          const preferredShipping=typeof shippingPrefill.shipping==='string'?shippingPrefill.shipping:'';
          const preferredMeta=shippingPrefill.shipping_meta&&typeof shippingPrefill.shipping_meta==='object'?shippingPrefill.shipping_meta:null;
          const officeCode=preferredMeta?String(preferredMeta.office_code||'').trim():'';
          const methodExists=!preferredShipping||(result.quote?.methods||[]).some(m=>m.id===preferredShipping);
          if(methodExists&&officeCode){
            shippingPrefillApplied.current=true;
            const nextShipping=preferredShipping||'econt_office';
            const nextMeta={...preferredMeta};
            setShipping(nextShipping);
            setShippingMeta(nextMeta);
            if(nextShipping!==result.quote?.shipping||String(result.quote?.shipping_meta?.office_code||'')!==officeCode){
              refresh(nextShipping, nextMeta, fieldsRef.current);
              return;
            }
          }
        }
      }catch(e){if(version===generation.current){setData(null);setFailure(e.message);}}
    }
    React.useEffect(()=>{refresh();return()=>{generation.current++;};},[cart.cart]);
    React.useEffect(()=>{
      const timer=setInterval(()=>{if(document.visibilityState==='visible'&&!sending.current)refresh();},30000);
      return()=>clearInterval(timer);
    },[]);
    React.useEffect(()=>{
      const onMeta=event=>{
        const detail=event.detail||{};
        const currentShipping=shippingRef.current;
        if(detail.shipping&&detail.shipping!==currentShipping) return;
        const next={...shippingMetaRef.current,...(detail.shipping_meta||{})};
        setShippingMeta(next);
        refresh(currentShipping, next, fieldsRef.current);
      };
      document.addEventListener('commerce:shipping-meta', onMeta);
      return()=>document.removeEventListener('commerce:shipping-meta', onMeta);
    },[]);
    function selectMethod(id) {
      shippingPrefillApplied.current=true;
      setShipping(id);
      setShippingMeta({});
      setErrors(v=>({...v,shipping:null,office_code:null}));
      refresh(id, {}, fieldsRef.current);
    }
    function focusInvalid(focusName) {
      if(!formRef.current) return;
      if(focusName==='office_code'){
        const trigger=formRef.current.querySelector('[data-econt-office-open], [data-commerce-shipping-mount] button, [data-commerce-shipping-mount] a');
        if(trigger&&typeof trigger.focus==='function'){trigger.focus();return;}
      }
      const el=formRef.current.querySelector('[name="'+focusName+'"]');
      if(el&&typeof el.focus==='function'&&el.type!=='hidden') el.focus();
    }
    async function submit(event) {
      event.preventDefault(); if(sending.current||!data||needsLogin)return;
      const invalid={};
      for(const key of ['first_name','last_name','email','phone']) if(!fields[key].trim())invalid[key]='Полето е задължително.';
      if(method.type==='address') for(const key of ['city','postcode','address']) if(!fields[key].trim())invalid[key]='Полето е задължително.';
      if(method.type==='office'&&!String(shippingMeta.office_code||'').trim())invalid.office_code='Изберете офис за доставка.';
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email))invalid.email='Въведете валиден имейл.';
      if(!/^[+0-9 ()-]{6,30}$/.test(fields.phone))invalid.phone='Въведете валиден телефон.';
      if(!fields.terms)invalid.terms='Приемете условията за покупка.';
      setErrors(invalid);if(Object.keys(invalid).length){
        const focusOrder=['first_name','last_name','email','phone','office_code','city','postcode','address','terms'];
        focusInvalid(focusOrder.find(name=>invalid[name])||Object.keys(invalid)[0]);
        return;
      }
      sending.current=true;setBusy(true);setFailure('');
      try {
        const payload={...fields,payment:'cod',shipping,shipping_meta:shippingMeta,fingerprint:data.quote.fingerprint,request_key:data.request_key};
        if(method.type==='office'){
          payload.city=String(shippingMeta.city||fields.city||'').trim();
          payload.postcode=String(shippingMeta.postcode||fields.postcode||'').trim();
          payload.address=String(shippingMeta.office_address||shippingMeta.office_name||fields.address||'').trim();
        }
        const response=await fetch(endpoint,{method:'POST',credentials:'same-origin',headers:{Accept:'application/json','Content-Type':'application/json','X-CSRF-Token':data.csrf_token},body:JSON.stringify(payload)});
        const result=await response.json();
        if(!response.ok){if(response.status===409)await refresh();throw new Error(result.error?.message||'Поръчката не беше изпратена.');}
        await requestCart().catch(()=>{});window.location.assign(result.url);
      }catch(e){setFailure(e.message);sending.current=false;setBusy(false);}
    }
    function field(name,label,options={}) {
      const id='checkout-'+name;
      return h('label',{className:'commerce-checkout-field flex-field '+(options.wide?'is-wide':''),htmlFor:id},h('span',{className:'flex-label'},label,name!=='note'&&h('span',{className:'commerce-required','aria-hidden':true},' *')),
        h(name==='note'?'textarea':'input',{id,name,type:options.type||'text',className:'flex-input',autoComplete:options.autoComplete,maxLength:options.maxLength||100,required:name!=='note'&&method.type==='address',value:fields[name],disabled:busy||needsLogin,'aria-invalid':!!errors[name],'aria-describedby':errors[name]?id+'-error':undefined,onChange:e=>{setFields(f=>({...f,[name]:e.target.value}));setErrors(v=>({...v,[name]:null}));}}),
        errors[name]&&h('small',{id:id+'-error',role:'alert'},errors[name]));
    }
    if(loading) return h(CheckoutSkeleton);
    if(!quote) {
      if(emptyCart) {
        return h('div',{className:'commerce-checkout-empty',role:'status'},
          h('h2',null,'Количката е празна'),
          h('p',null,'Добавете продукти, преди да завършите поръчката.'),
          h('div',{className:'commerce-checkout-empty-actions'},
            h('a',{href:'/cart',className:'flex-btn flex-btn--secondary'},'Към количката'),
            h('a',{href:'/catalog',className:'flex-btn flex-btn--primary commerce-cart-primary'},'Към каталога')));
      }
      return h('div',{className:'commerce-checkout-empty'},
        failure&&h('div',{className:'commerce-checkout-error',role:'alert'},failure),
        h('a',{href:'/cart'},'Към количката'),
        failure&&h('button',{type:'button',onClick:()=>refresh()},'Опитай отново'));
    }
    return h(React.Fragment,null,
      needsLogin&&h('div',{className:'commerce-checkout-login-note',role:'status'},
        h('p',null,'За да завършите поръчката, влезте в профила си.'),
        h('a',{href:loginUrl,className:'flex-btn flex-btn--primary commerce-cart-primary'},'Вход')),
      failure&&h('div',{className:'commerce-checkout-error',role:'alert'},failure),
      h('form',{ref:formRef,onSubmit:submit,noValidate:true,className:'commerce-checkout-layout'},
        h('div',{className:'commerce-checkout-details'},
          h('section',{className:'commerce-checkout-card'},h('h2',null,'1. Вашите данни'),h('div',{className:'commerce-checkout-fields'},field('first_name','Име',{autoComplete:'given-name',maxLength:80}),field('last_name','Фамилия',{autoComplete:'family-name',maxLength:80}),field('email','Имейл',{type:'email',autoComplete:'email',maxLength:190}),field('phone','Телефон',{type:'tel',autoComplete:'tel',maxLength:30}))),
          h('section',{className:'commerce-checkout-card'},
            h('h2',null,'2. Доставка'),
            methods.length>1&&h('div',{className:'commerce-checkout-methods',role:'radiogroup','aria-label':'Начин на доставка'},
              methods.map(entry=>h('label',{key:entry.id,className:'commerce-checkout-method'+(shipping===entry.id?' is-selected':'')},
                h('input',{type:'radio',name:'shipping',value:entry.id,checked:shipping===entry.id,disabled:busy||needsLogin,onChange:()=>selectMethod(entry.id)}),
                h('span',null,entry.label)))),
            method.type==='office'&&h('div',{className:'commerce-checkout-shipping'},
              h('input',{type:'hidden',id:'checkout-office_code',name:'office_code',value:shippingMeta.office_code||'','aria-invalid':!!errors.office_code,'aria-describedby':errors.office_code?'checkout-office_code-error':undefined,onChange:e=>{
                const next={...shippingMeta,office_code:String(e.target.value||'').trim()};
                setShippingMeta(next);setErrors(v=>({...v,office_code:null}));
              }}),
              h('div',{
                className:'commerce-checkout-shipping-mount'+(errors.office_code?' is-invalid':''),
                'data-commerce-shipping-mount':'',
                'data-shipping-method':method.id,
                'data-shipping-meta':JSON.stringify(shippingMeta),
                'data-office-error':errors.office_code||'',
              }),
              errors.office_code&&h('small',{id:'checkout-office_code-error',className:'commerce-checkout-office-error',role:'alert'},errors.office_code)),
            method.type==='address'&&h('div',{className:'commerce-checkout-fields'},
              field('city','Град',{autoComplete:'address-level2'}),
              field('postcode','Пощенски код',{autoComplete:'postal-code',maxLength:20}),
              field('address','Улица, номер и допълнения към адреса',{autoComplete:'street-address',maxLength:300,wide:true}),
              field('note','Бележка към поръчката',{maxLength:2000,wide:true})),
            method.type==='office'&&h('div',{className:'commerce-checkout-fields'},
              field('note','Бележка към поръчката',{maxLength:2000,wide:true})),
            method.type==='custom'&&h('div',{className:'commerce-checkout-shipping-mount','data-commerce-shipping-mount':'','data-shipping-method':method.id})),
          h('section',{className:'commerce-checkout-card'},h('h2',null,'3. Плащане'),h('div',{className:'commerce-checkout-payment'},h('strong',null,'Наложен платеж'),h('p',null,'Платете при получаване на поръчката.')))),
        h('aside',{className:'commerce-checkout-summary commerce-checkout-card','aria-label':'Обобщение на поръчката'},h('h2',null,'Вашата поръчка'),quote.items.map(item=>h('div',{className:'commerce-checkout-line',key:item.product_id},h('span',null,item.name,h('small',null,'Количество: '+item.quantity)),h('strong',null,amount(item.line_minor,quote.currency)))),
          h('div',{className:'commerce-checkout-line'},h('span',null,'Междинна сума'),h('span',null,amount(quote.subtotal_minor,quote.currency))),h('div',{className:'commerce-checkout-line'},h('span',null,'Доставка'),h('span',null,quote.shipping_minor?amount(quote.shipping_minor,quote.currency):'Безплатна')),h('div',{className:'commerce-checkout-line is-total'},h('span',null,'Общо'),h('strong',null,amount(quote.total_minor,quote.currency))),
          h(Checkbox,{name:'terms',required:true,checked:fields.terms,disabled:busy||needsLogin,invalid:!!errors.terms,className:'commerce-checkout-terms',onChange:e=>{setFields(f=>({...f,terms:e.target.checked}));setErrors(v=>({...v,terms:null}));}},'Приемам условията за покупка',' *'),
          errors.terms&&h('small',{role:'alert'},errors.terms),
          (quote.terms_url||quote.privacy_url)&&h('p',{className:'commerce-checkout-legal'},
            quote.terms_url&&h('a',{href:quote.terms_url,target:'_blank',rel:'noopener'},'Общи условия'),
            quote.terms_url&&quote.privacy_url&&h('span',{'aria-hidden':true},' · '),
            quote.privacy_url&&h('a',{href:quote.privacy_url,target:'_blank',rel:'noopener'},'Политика за поверителност')),
          needsLogin
            ? h('a',{href:loginUrl,className:'flex-btn flex-btn--primary commerce-cart-primary'},'Влезте, за да поръчате')
            : h('button',{type:'submit',className:'flex-btn flex-btn--primary commerce-cart-primary'+(busy?' is-loading':''),disabled:busy||cart.busy,'aria-busy':busy||undefined},
                busy&&h('span',{className:'commerce-cart-btn-spinner','aria-hidden':true}),
                busy?'Изпращане…':'Потвърди поръчката'),
          h('p',{className:'commerce-checkout-hint'},'Плащане при получаване · '+method.label),h('a',{href:'/cart'},'Редактирай количката'))));
  }
  if(!window.__flexCommerceCheckoutRegistered){
    rt.register('commerce.checkout',Checkout);
    window.__flexCommerceCheckoutRegistered=true;
  }
  const mount=()=>document.querySelectorAll('[data-commerce-checkout]').forEach(root=>rt.mount('commerce.checkout',root,{}));
  mount();document.addEventListener('flex:page-ready',mount);
  document.addEventListener('flex:page-before-change',()=>document.querySelectorAll('[data-commerce-checkout]').forEach(root=>rt.unmount(root)));
}
if(window.FlexStorefront)initialize(window.FlexStorefront);else window.addEventListener('flex:storefront-ready',e=>initialize(e.detail),{once:true});

export function createOrdersPage(host, ui) {
  const {React,C,icons,request,toast,h,Select,Field,error,button}=ui;
  const endpoint='/admin/plugins/flex/commerce/orders';
  // Platform time standard (0.1.59+); older platforms show the stored UTC value.
  const when=(value)=>C.DateTime?h(C.DateTime,{value}):value;
  const statuses={new:'Нова',processing:'В обработка',shipped:'Изпратена',completed:'Завършена',cancelled:'Отказана'};
  const payments={unpaid:'Неплатена',paid:'Платена',refunded:'Възстановена сума'};
  const transitions={new:['new','processing','cancelled'],processing:['processing','shipped','completed','cancelled'],shipped:['shipped','completed','cancelled'],completed:['completed','cancelled'],cancelled:['cancelled']};
  const money=(minor,currency)=>new Intl.NumberFormat('bg-BG',{style:'currency',currency}).format(minor/100);
  return function OrdersPage({navigate}) {
    const [data,setData]=React.useState({records:[],page:1,pages:1,count:0}),[page,setPage]=React.useState(1),[q,setQ]=React.useState(''),[status,setStatus]=React.useState('all'),[revision,setRevision]=React.useState(0),[loading,setLoading]=React.useState(true),[failure,setFailure]=React.useState(''),[order,setOrder]=React.useState(null),[busy,setBusy]=React.useState(false),[selected,setSelected]=React.useState(new Set()),[confirm,setConfirm]=React.useState(null);
    React.useEffect(()=>{
      const abort=new AbortController();setLoading(true);
      const timer=setTimeout(()=>request(endpoint+'?'+new URLSearchParams({q,status,page}),'GET',undefined,abort.signal).then(result=>{setData(result);setSelected(new Set());setFailure('');}).catch(e=>{if(!abort.signal.aborted)setFailure(e.message);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);}),250);
      return()=>{clearTimeout(timer);abort.abort();};
    },[q,status,page,revision]);
    React.useEffect(()=>{const reload=()=>setRevision(v=>v+1);window.addEventListener('flex:workspace-reload',reload);return()=>window.removeEventListener('flex:workspace-reload',reload);},[]);
    async function change(row,patch) {
      const result=await request(endpoint+'/'+row.id,'PUT',{version:row.version,...patch});return result.record;
    }
    async function save(event) {
      event.preventDefault();if(busy)return;
      if(order.status==='cancelled'&&order.original_status!=='cancelled'){setConfirm({rows:[order],patch:{status:order.status,payment_status:order.payment_status}});return;}
      setBusy(true);setFailure('');try{const updated=await change(order,{status:order.status,payment_status:order.payment_status});setOrder({...updated,original_status:updated.status});setRevision(v=>v+1);toast.success('Поръчката е обновена.');}catch(e){setFailure(e.message);}finally{setBusy(false);}
    }
    async function bulk(rows,patch) {
      setBusy(true);setFailure('');let successes=0;const failures=[];
      for(const row of rows)try{const updated=await change(row,patch);successes++;if(order?.id===updated.id)setOrder({...updated,original_status:updated.status});}catch(e){failures.push(row.number+': '+e.message);}
      setBusy(false);setConfirm(null);setRevision(v=>v+1);if(successes)toast.success(successes+' поръчки обновени.');if(failures.length)setFailure(failures.join(' '));
    }
    const open=row=>{setFailure('');setOrder({...row,original_status:row.status});};
    return h(React.Fragment,null,h('div',{className:'react-page-heading'},h('div',null,h('h1',null,'Поръчки'),h(C.Breadcrumbs,{items:[{label:'Поръчки'}],onHomeClick:()=>navigate('/')}))),error(failure),
      h(C.DataTable,{data:data.records,rowKey:r=>r.id,loading,emptyMessage:'Няма поръчки.',pageSize:25,selectable:!busy,selectedKeys:selected,onSelectionChange:setSelected,
        toolbar:h('div',{className:'commerce-orders-filters'},h(Field,{label:'Търсене по номер или клиент',value:q,onChange:e=>{setQ(e.target.value);setPage(1);}}),h(Select,{label:'Статус',value:status,options:{all:'Всички',...statuses},onChange:v=>{setStatus(v);setPage(1);}})),
        bulkActions:h(React.Fragment,null,h('strong',null,selected.size+' избрани'),button('В обработка',()=>bulk(data.records.filter(r=>selected.has(r.id)),{status:'processing'}),{disabled:busy}),button('Откажи',()=>setConfirm({rows:data.records.filter(r=>selected.has(r.id)),patch:{status:'cancelled'}}),{disabled:busy})),
        columns:[{key:'number',label:'Поръчка',render:r=>h('a',{href:'#order-'+r.id,className:'react-page-link',onClick:e=>{e.preventDefault();open(r);}},r.number)},{key:'customer',label:'Клиент',render:r=>r.customer.first_name+' '+r.customer.last_name},{key:'created_at',label:'Дата',render:r=>when(r.created_at),sortValue:r=>host.time?.parse(r.created_at)?.valueOf()??r.created_at},{key:'total_minor',label:'Сума',render:r=>money(r.total_minor,r.currency)},{key:'payment_status',label:'Плащане',render:r=>payments[r.payment_status]},{key:'status',label:'Статус',render:r=>statuses[r.status]},{key:'actions',label:'Действия',render:r=>h(C.TableActionsMenu,null,h(C.DropdownOption,{onClick:()=>open(r)},'Преглед'))}]}),
      h('div',{className:'react-form-actions'},button('Предишни',()=>setPage(data.page-1),{disabled:busy||loading||data.page<=1}),h('span',null,'Страница '+data.page+' от '+data.pages+' · '+data.count+' поръчки'),button('Следващи',()=>setPage(data.page+1),{disabled:busy||loading||data.page>=data.pages})),
      h(C.Dialog,{open:!!order,title:order?'Поръчка '+order.number:'Поръчка',onClose:()=>{if(!busy)setOrder(null);}},order&&h('form',{onSubmit:save,className:'commerce-order-editor'},error(failure),
        h(C.CollapsibleSection,{title:'Клиент и доставка',storageKey:'commerce-order-customer'},h('p',null,order.customer.first_name+' '+order.customer.last_name),h('p',null,order.customer.email+' · '+order.customer.phone),h('p',null,order.customer.city+' '+order.customer.postcode+', '+order.customer.address),order.customer.note&&h('p',null,'Бележка: '+order.customer.note),h('p',null,'Наложен платеж · Доставка до адрес')),
        h(C.CollapsibleSection,{title:'Продукти и суми',storageKey:'commerce-order-items'},h(C.DataTable,{data:order.items,rowKey:r=>r.product_id,columns:[{key:'name',label:'Продукт'},{key:'sku',label:'Код'},{key:'quantity',label:'Брой'},{key:'price_minor',label:'Единична цена',render:r=>money(r.price_minor,order.currency)},{key:'line_minor',label:'Общо',render:r=>money(r.line_minor,order.currency)}]}),h('p',null,'Доставка: '+money(order.shipping_minor,order.currency)),h('strong',null,'Общо: '+money(order.total_minor,order.currency))),
        h(C.CollapsibleSection,{title:'Статус и плащане',storageKey:'commerce-order-status'},h('div',{className:'react-form-grid'},h(Select,{label:'Статус на поръчката',value:order.status,disabled:busy,options:Object.fromEntries(transitions[order.original_status].map(k=>[k,statuses[k]])),onChange:v=>setOrder(o=>({...o,status:v}))}),h(Select,{label:'Статус на плащането',value:order.payment_status,options:payments,disabled:busy,onChange:v=>setOrder(o=>({...o,payment_status:v}))})),h('p',{className:'react-field-hint'},'Отказът възстановява наличността веднъж. Завършването отчита продажбите. Статусът на плащането се отбелязва отделно.')),
        h(C.CollapsibleSection,{title:'История',storageKey:'commerce-order-history'},h('ol',null,order.history.map((entry,index)=>h('li',{key:index},when(entry.at),' · '+statuses[entry.status]+' · '+payments[entry.payment_status]+(entry.actor?' · Администратор #'+entry.actor:''))))),
        h(C.LoadingButton,{type:'submit',loading:busy,icon:h(icons.Save)},'Запази'))),
      h(C.ConfirmDialog,{open:!!confirm,title:'Отказ на поръчки',message:'Поръчките ще бъдат отказани и наличностите ще се възстановят. Това действие не възстановява платени суми автоматично.',confirmLabel:'Откажи поръчките',danger:true,busy,onCancel:()=>{if(!busy)setConfirm(null);},onConfirm:()=>bulk(confirm.rows,confirm.patch)}));
  };
}

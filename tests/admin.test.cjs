const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
global.window = {
  dispatchEvent() {},
  addEventListener() {},
  removeEventListener() {},
};

async function harness() {
  const module = await import(require('node:url').pathToFileURL(path.join(__dirname, '../assets/admin.js')).href);
  const states = [],
    effects = [],
    calls = [];
  let cursor = 0,
    dirty = 0,
    saved = 0;
  const React = {
    Fragment: "Fragment",
    useMemo: (factory) => factory(),
    createElement: (type, props, ...children) => ({
      type,
      props: { ...props, children },
    }),
    useState: (initial) => {
      const index = cursor++;
      if (!(index in states))
        states[index] = typeof initial === "function" ? initial() : initial;
      return [
        states[index],
        (value) => {
          states[index] =
            typeof value === "function" ? value(states[index]) : value;
        },
      ];
    },
    useEffect: (fn) => effects.push(fn),
    useId: () => "test-gallery",
    useRef: (initial) => {
      const index = cursor++;
      if (!(index in states)) states[index] = { current: initial };
      return states[index];
    },
  };
  const components = Object.fromEntries(
    [
      "Button",
      "LoadingButton",
      "Input",
      "Textarea",
      "RichTextEditor",
      "Breadcrumbs",
      "CheckboxField",
      "DataTable",
      "DropdownMenu",
      "DropdownOption",
      "DropdownChevron",
      "TableActionsMenu",
      "CollapsibleSection",
      "ConfirmDialog",
      "MediaPicker",
      "Dialog",
    ].map((key) => [key, key]),
  );
  const host = {
    React,
    components,
    icons: { Settings: function Settings() {} },
    toast: { success() {}, error() {} },
    useWorkspaceChanged: () => () => dirty++,
    useWorkspaceSaved: () => () => saved++,
    request: async (url, method, body) => {
      calls.push({ url, method, body });
      if (method === "POST") return { record: { ...body, id: 8, version: 1 } };
      return {
        records: url.includes("categories")
          ? [{ id: 1, name: "Облекло", status: "active" }]
          : [
              {
                id: 8,
                name: "Продукт",
                status: "active",
                price: "10.00",
                currency: "EUR",
                stock: 3,
              },
            ],
      };
    },
  };
  function render(Component, props) {
    cursor = 0;
    return Component(props);
  }
  function all(tree, predicate) {
    if (!tree || typeof tree !== "object") return [];
    if (Array.isArray(tree))
      return tree.flatMap((item) => all(item, predicate));
    return [
      ...(predicate(tree) ? [tree] : []),
      ...all(tree.props?.children, predicate),
    ];
  }
  return {
    module,
    host,
    render,
    all,
    effects,
    calls,
    dirty: () => dirty,
    saved: () => saved,
  };
}

const base = "/extension-pages/flex-commerce-products";
async function editor(t) {
  const page = t.module.createPage(t.host);
  const root = t.render(page, { path: base + "/create", navigate: () => {} });
  const node = t.all(
    root,
    (n) => typeof n.type === "function" && n.type.name === "Editor",
  )[0];
  t.render(node.type, node.props);
  for (const effect of t.effects.splice(0)) effect();
  await new Promise((r) => setImmediate(r));
  return { node, render: () => t.render(node.type, node.props) };
}
test("product editor saves exact textual price, category selection and ordered media", async () => {
  const t = await harness();
  const e = await editor(t);
  let tree = e.render();
  for (const [label, value] of [
    ["Име", "Тестов продукт"],
    ["Цена", "12.34"],
    ["Наличност", "4"],
  ]) {
    const field = t.all(
      tree,
      (n) => n.type?.name === "Field" && n.props.label === label,
    )[0];
    assert.ok(field);
    field.props.onChange({ target: { value } });
    tree = e.render();
  }
  const checkbox = t.all(
    tree,
    (n) => n.type === "CheckboxField" && n.props.label === "Облекло",
  )[0];
  checkbox.props.onChange({ target: { checked: true } });
  tree = e.render();
  const topSwitch = t.all(tree, (n) => n.type === "CheckboxField" && n.props.label === "Топ продукт")[0];
  topSwitch.props.onChange({ target: { checked: true } });
  tree = e.render();
  const picker = t.all(tree, (n) => n.type === "MediaPicker")[0];
  picker.props.onSelectMany([
    { id: 2, title: "Втора" },
    { id: 1, title: "Първа" },
    { id: 2, title: "Повторение" },
  ]);
  tree = e.render();
  await t
    .all(tree, (n) => n.type === "form")[0]
    .props.onSubmit({ preventDefault() {} });
  const save = t.calls.find((c) => c.method === "POST");
  assert.equal(save.body.price, "12.34");
  assert.equal(save.body.is_top, true);
  assert.deepEqual(save.body.category_ids, [1]);
  assert.deepEqual(save.body.images, [2, 1]);
  assert.ok(t.dirty() > 0);
  assert.equal(t.saved(), 1);
});
test("catalog uses shared table and asks before trashing records", async () => {
  const t = await harness(),
    Page = t.module.createPage(t.host);
  const root = t.render(Page, { path: base, navigate: () => {} }),
    node = t.all(root, (n) => n.type?.name === "List")[0];
  t.render(node.type, node.props);
  for (const effect of t.effects.splice(0)) effect();
  await new Promise((r) => setImmediate(r));
  let tree = t.render(node.type, node.props);
  const table = t.all(tree, (n) => n.type === "DataTable")[0];
  assert.equal(table.props.data.length, 1);
  const action = table.props.columns
    .find((c) => c.key === "actions")
    .render(table.props.data[0]);
  t.all(action, (n) => n.type === "DropdownOption")[1].props.onClick();
  assert.equal(t.calls.filter((c) => c.method === "DELETE").length, 0);
  tree = t.render(node.type, node.props);
  const dialog = t.all(tree, (n) => n.type === "ConfirmDialog")[0];
  assert.equal(dialog.props.open, true);
  await dialog.props.onConfirm();
  assert.equal(t.calls.filter((c) => c.method === "DELETE").length, 1);
});

test("collapsible sections receive an icon component instead of a React element", async () => {
  const t = await harness();
  const e = await editor(t);
  const sections = t.all(e.render(), (n) => n.type === "CollapsibleSection");
  assert.ok(sections.length > 0);
  for (const section of sections)
    assert.equal(section.props.icon, t.host.icons.Settings);
});

test("dragging an image inserts it at the marked position and saves the order", async () => {
  const t = await harness();
  const e = await editor(t);
  t.all(e.render(), n => n.type === "MediaPicker")[0].props.onSelectMany([{ id: 1 }, { id: 2 }, { id: 3 }]);
  const cards = () => t.all(e.render(), n => n.type === "div" && n.props.draggable === true);
  cards()[0].props.onDragStart({ target: { closest: () => null }, dataTransfer: { setData() {} } });
  cards()[2].props.onDragOver({ preventDefault() {}, clientX: 90, dataTransfer: {}, currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 100 }) } });
  assert.match(cards()[2].props.className, /is-drop-after/);
  cards()[2].props.onDrop({ preventDefault() {} });
  assert.equal(cards()[0].props.className.includes("is-primary"), false);
  await t.all(e.render(), n => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
  assert.deepEqual(t.calls.find(c => c.method === "POST").body.images, [2, 3, 1]);
});

test("product description uses the shared editor and saves formatted content", async () => {
  const t = await harness();
  const e = await editor(t);
  const tree = e.render();
  const wrapper = t.all(tree, n => n.props?.className?.includes("commerce-product-description"))[0];
  assert.ok(wrapper);
  const rich = t.all(wrapper, n => n.type === "RichTextEditor")[0];
  assert.ok(rich);
  rich.props.onChange('<p><strong>Описание</strong></p>');
  await t.all(e.render(), n => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
  assert.equal(t.calls.find(c => c.method === "POST").body.description, '<p><strong>Описание</strong></p>');
});

test("200 images use thumbnails and mount only the selected settings dialog", async () => {
  const t = await harness();
  const e = await editor(t);
  const media = Array.from({ length: 200 }, (_, index) => ({ id: index + 1, thumbnail_url: '/thumb/' + index, url: '/original/' + index }));
  t.all(e.render(), n => n.type === "MediaPicker")[0].props.onSelectMany(media);
  let tree = e.render();
  const images = t.all(tree, n => n.type === "img");
  assert.equal(images.length, 200);
  assert.ok(images.every(n => n.props.src.startsWith('/thumb/') && n.props.decoding === 'async' && n.props.loading === 'lazy'));
  assert.equal(t.all(tree, n => n.type === "Dialog").length, 0);
  t.all(tree, n => n.props?.['aria-label'] === 'Редактирай изображението')[0].props.onClick();
  tree = e.render();
  assert.equal(t.all(tree, n => n.type === "Dialog").length, 1);
  t.all(tree, n => n.type === "Dialog")[0].props.onClose();
  assert.equal(t.all(e.render(), n => n.type === "Dialog").length, 0);
});

test("commerce table uses text links and confirms bulk trash before sending requests", async () => {
  const t = await harness();
  const Page = t.module.createPage(t.host);
  const node = t.all(t.render(Page, { path: base, navigate() {} }), n => n.type?.name === "List")[0];
  const render = () => t.render(node.type, node.props);
  render(); for (const effect of t.effects.splice(0)) effect();
  await new Promise(r => setImmediate(r));
  let table = t.all(render(), n => n.type === "DataTable")[0];
  const link = table.props.columns.find(c => c.key === "name").render(table.props.data[0]);
  assert.equal(link.type, "a"); assert.equal(link.props.className, "react-page-link");
  assert.equal(table.props.selectable, true);
  assert.ok(t.all(table.props.bulkActions, n => n.type === "LoadingButton").every(n => n.props.disabled));
  table.props.onSelectionChange(new Set([8]));
  table = t.all(render(), n => n.type === "DataTable")[0];
  t.all(table.props.bulkActions, n => n.props?.key === 'trash')[0].props.onClick();
  assert.equal(t.calls.filter(c => c.method === 'DELETE').length, 0);
  const dialog = t.all(render(), n => n.type === 'ConfirmDialog')[0];
  assert.match(dialog.props.message, /1 избрани/);
  await dialog.props.onConfirm();
  assert.equal(t.calls.filter(c => c.method === 'DELETE').length, 1);
  assert.equal(t.all(render(), n => n.type === 'DataTable')[0].props.selectedKeys.size, 0);
});

test('sales page records confirmed quantities and confirms reversible cancellation', async()=>{
 const t=await harness();t.host.request=async(url,method,body)=>{t.calls.push({url,method,body});if(url.endsWith('/products'))return {records:[{id:8,name:'Gift'}]};return {ranking:[{id:8,name:'Gift',sold:3,status:'active'}],sales:[{id:2,name:'Gift',reference:'ORDER-1',quantity:3,cancelled:false}]};};
 const page=t.module.createPage(t.host);const root=t.render(page,{path:'/extension-pages/flex-commerce-sales',navigate(){}});
 const node=t.all(root,n=>typeof n.type==='function'&&n.type.name==='SalesPage')[0];t.render(node.type,node.props);for(const effect of t.effects.splice(0))effect();await new Promise(resolve=>setImmediate(resolve));
 let tree=t.render(node.type,node.props);assert.equal(t.all(tree,n=>n.type==='DataTable')[0].props.data[0].sold,3);
 for(const table of t.all(tree,n=>n.type==='DataTable')) assert.equal(table.props.rowKey(table.props.data[0]),table.props.data[0].id);
 const action=t.all(tree,n=>n.type==='DataTable')[1].props.columns.find(c=>c.key==='actions').render({id:2,cancelled:false});action.props.onClick();tree=t.render(node.type,node.props);
 await t.all(tree,n=>n.type==='ConfirmDialog')[0].props.onConfirm();assert.deepEqual(t.calls.at(-1),{url:'/admin/plugins/flex/commerce/sales/2',method:'PUT',body:{cancelled:true}});
});

test('product table exposes numeric sorting by sold quantities', async()=>{
 const t=await harness();const page=t.module.createPage(t.host);const root=t.render(page,{path:base,navigate(){}});const node=t.all(root,n=>typeof n.type==='function'&&n.type.name==='List')[0];const tree=t.render(node.type,node.props);const table=t.all(tree,n=>n.type==='DataTable')[0];const column=table.props.columns.find(c=>c.key==='sold');assert.equal(column.sortable,true);assert.equal(column.sortValue({sold:10}),10);assert.equal(column.render({sold:0}),0);assert.equal(column.sortValue({}),0);
});

test('images are first and primary selection is independent of additional images',async()=>{
 const t=await harness(),e=await editor(t);let tree=e.render();assert.equal(t.all(tree,n=>n.type==='CollapsibleSection')[0].props.title,'Изображения');
 let picker=t.all(tree,n=>n.type==='MediaPicker')[0];picker.props.onSelectMany([{id:2},{id:3}]);tree=e.render();picker=t.all(tree,n=>n.type==='MediaPicker')[0];picker.props.onSelect({id:1});tree=e.render();
 const primary=t.all(tree,n=>n.type==='div'&&n.props.className?.includes('is-primary'))[0];assert.equal(primary.props.draggable,false);
 await t.all(tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});const saved=t.calls.find(c=>c.method==='POST').body;assert.equal(saved.primary_image_id,1);assert.deepEqual(saved.images,[1,2,3]);
});

test('additional image can become primary without losing images or their metadata', async()=>{
 const t=await harness(),e=await editor(t);
 let picker=t.all(e.render(),n=>n.type==='MediaPicker')[0];picker.props.onSelect({id:1,title:'Front'});
 picker=t.all(e.render(),n=>n.type==='MediaPicker')[0];picker.props.onSelectMany([{id:2,title:'Extra'},{id:3}]);
 t.all(e.render(),n=>n.props?.className==='commerce-make-primary')[0].props.onClick();
 const tree=e.render();assert.equal(t.all(tree,n=>n.props?.className==='commerce-make-primary').length,2);
 await t.all(tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});
 const saved=t.calls.find(c=>c.method==='POST').body;assert.equal(saved.primary_image_id,2);assert.deepEqual(saved.images,[2,1,3]);
});

test('order table opens details and cancellation requires confirmation',async()=>{
 const t=await harness();const row={id:1,number:'FC-TEST',status:'new',payment_status:'unpaid',version:1,currency:'EUR',total_minor:2100,shipping_minor:500,created_at:'2026-10-08 00:00:00',customer:{first_name:'Иван',last_name:'Иванов',email:'test@example.invalid',phone:'12345678',city:'София',postcode:'1000',address:'Улица 1',note:''},items:[{product_id:1,name:'Gift',quantity:2,price_minor:800,line_minor:1600}],history:[{status:'new',payment_status:'unpaid',at:'2026-10-08',actor:null}]};
 t.host.request=async(url,method,body)=>{t.calls.push({url,method,body});return method==='PUT'?{record:{...row,...body,version:2}}:{records:[row],page:1,pages:1,count:1};};
 const Page=t.module.createPage(t.host);const node=t.all(t.render(Page,{path:'/extension-pages/flex-commerce-orders',navigate(){}}),n=>n.type?.name==='OrdersPage')[0];const render=()=>t.render(node.type,node.props);render();for(const effect of t.effects.splice(0))effect();await new Promise(r=>setTimeout(r,300));
 let table=t.all(render(),n=>n.type==='DataTable')[0];const link=table.props.columns[0].render(row);assert.equal(link.props.className,'react-page-link');link.props.onClick({preventDefault(){}});
 let tree=render();assert.equal(t.all(tree,n=>n.type==='Dialog')[0].props.open,true);
 const select=t.all(tree,n=>n.type?.name==='Select'&&n.props.label==='Статус на поръчката')[0];select.props.onChange('cancelled');tree=render();await t.all(tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});assert.equal(t.calls.filter(c=>c.method==='PUT').length,0);
 const confirmation=t.all(render(),n=>n.type==='ConfirmDialog')[0];assert.equal(confirmation.props.open,true);await confirmation.props.onConfirm();assert.equal(t.calls.at(-1).body.status,'cancelled');assert.equal(t.calls.at(-1).body.version,1);
});

test("the editor shows panels of other plugins and saves them after the product", async () => {
  const t = await harness();
  const runs = [];
  t.host.components.ExtensionPanels = "ExtensionPanels";
  t.host.usePanelSaves = () => ({ run: async (context) => runs.push(context) });
  const e = await editor(t);
  const panels = t.all(e.render(), (n) => n.type === "ExtensionPanels");
  assert.equal(panels.length, 1);
  assert.equal(panels[0].props.location, "commerce.product.editor");
  assert.equal(panels[0].props.context.type, "product");
  await t.all(e.render(), (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
  assert.deepEqual(runs, [{ id: 8 }], "Panels save with the ID of the new product.");
});

test("the editor works without panel support on older platforms", async () => {
  const t = await harness();
  const e = await editor(t);
  assert.equal(t.all(e.render(), (n) => n.type === "ExtensionPanels").length, 0);
});

test("editor sections are named extension points and share the record with extensions", async () => {
  const t = await harness();
  t.host.components.ExtensionScope = "ExtensionScope";
  t.host.usePanelSaves = () => ({ run: async () => {} });
  const e = await editor(t);
  const tree = e.render();
  const points = t
    .all(tree, (n) => n.type === "CollapsibleSection")
    .map((n) => n.props.extensionPoint);
  assert.deepEqual(points, [
    "commerce.product.editor.images",
    "commerce.product.editor.basic",
    "commerce.product.editor.pricing",
    "commerce.product.editor.categories",
  ]);
  const scope = t.all(tree, (n) => n.type === "ExtensionScope")[0];
  assert.equal(scope.props.value.context.type, "product");
  assert.equal(typeof scope.props.value.saves.run, "function");
});
test("category editor opens a saved category, whose record has no images or media", async () => {
  const t = await harness();
  t.host.request = async (url) =>
    url.endsWith("/categories/2")
      ? { record: { id: 2, name: "За дома", slug: "gift-home", description: "<p>Уют</p>", status: "active", version: 1 } }
      : { records: [] };
  const page = t.module.createPage(t.host);
  const root = t.render(page, { path: "/extension-pages/flex-commerce-categories/2/edit", navigate: () => {} });
  const node = t.all(root, (n) => typeof n.type === "function" && n.type.name === "Editor")[0];
  t.render(node.type, node.props);
  for (const effect of t.effects.splice(0)) effect();
  await new Promise((r) => setImmediate(r));
  const tree = t.render(node.type, node.props);
  const name = t.all(tree, (n) => n.type?.name === "Field" && n.props.label === "Име")[0];
  assert.equal(name.props.value, "За дома");
});
test("sales page renders the history dates and their sort values", async () => {
  const t = await harness();
  t.host.components.DateTime = "DateTime";
  t.host.time = { parse: (value) => ({ valueOf: () => Date.parse(value.replace(" ", "T") + "Z") }) };
  const sale = { id: 2, name: "Комплект", reference: "FC-1", quantity: 1, cancelled: false, created_at: "2026-10-09 03:13:55" };
  const page = t.module.createPage(t.host);
  const root = t.render(page, { path: "/extension-pages/flex-commerce-sales", navigate: () => {} });
  const node = t.all(root, (n) => typeof n.type === "function" && n.type.name === "SalesPage")[0];
  const tree = t.render(node.type, node.props);
  const history = t.all(tree, (n) => n.type === "DataTable" && n.props.extensionPoint === "commerce.sales.history")[0];
  const date = history.props.columns.find((column) => column.key === "created_at");
  assert.equal(date.render(sale).type, "DateTime");
  assert.equal(date.sortValue(sale), Date.parse("2026-10-09T03:13:55Z"));
});

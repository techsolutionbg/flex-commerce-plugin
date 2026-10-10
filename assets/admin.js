import { createOrdersPage } from './orders-admin.js';
const statuses = { active: "Активен", inactive: "Неактивен", draft: "Чернова" };
const root = "/admin/plugins/flex/commerce";
const baseFor = (kind) => "/extension-pages/flex-commerce-" + kind;
const blank = () => ({
  name: "",
  slug: "",
  description: "",
  status: "draft",
  sku: "",
  price: "0.00",
  sale_price: "",
  is_top: false,
  currency: "EUR",
  stock: 0,
  images: [],
  primary_image_id: null,
  image_details: {},
  media: [],
  category_ids: [],
  version: 1,
});
function ui(host) {
  const { React, components: C, icons, request, toast } = host;
  const h = React.createElement;
  // Platform time standard (0.1.59+); older platforms show the stored UTC value.
  const when = (value, style) =>
    C.DateTime ? h(C.DateTime, { value, style }) : value || "—";
  const whenSort = (value) => host.time?.parse(value)?.valueOf() ?? String(value ?? "");
  function Select({ label, value, options, onChange, hint, disabled }) {
    return h(
      "label",
      { className: "react-form-field" },
      label,
      h(
        C.DropdownMenu,
        {
          ariaLabel: label,
          triggerClassName: "react-form-dropdown",
          disabled,
          trigger: h(
            React.Fragment,
            null,
            h("span", null, options[value] ?? "Избери…"),
            h(C.DropdownChevron),
          ),
        },
        ...Object.entries(options).map(([key, text]) =>
          h(
            C.DropdownOption,
            {
              key,
              selected: key === String(value),
              disabled,
              onClick: () => onChange(key),
            },
            text,
          ),
        ),
      ),
      hint && h("small", { className: "react-field-hint" }, hint),
    );
  }
  function Field({ label, hint, multiline, className = "", ...props }) {
    return h(
      "label",
      { className: `react-form-field ${className}`.trim() },
      label,
      h(multiline ? C.Textarea : C.Input, props),
      hint && h("small", { className: "react-field-hint" }, hint),
    );
  }
  const error = (message) =>
    message &&
    h("p", { className: "react-form-error", role: "alert" }, message);
  const button = (text, onClick, extra = {}) =>
    h(
      C.Button,
      { type: "button", variant: "secondary", onClick, ...extra },
      text,
    );
  return { React, C, icons, request, toast, h, Select, Field, error, button };
}

export function createPage(host) {
  const { React, C, icons, request, toast, h, Select, Field, error, button } =
    ui(host);
  const OrdersPage = createOrdersPage(host, ui(host));
  function Heading({ title, kind, navigate, action }) {
    return h(
      "div",
      { className: "react-page-heading" },
      h(
        "div",
        null,
        h("h1", null, title),
        h(C.Breadcrumbs, {
          items:
            title ===
            (kind === "products" ? "Продукти" : "Категории")
              ? [{ label: title }]
              : [
                  {
                    label:
                      kind === "products"
                        ? "Продукти"
                        : "Категории",
                    onClick: () => navigate(baseFor(kind)),
                  },
                  { label: title },
                ],
          onHomeClick: () => navigate("/"),
        }),
      ),
      action,
    );
  }
  function List({ kind, navigate }) {
    const [rows, setRows] = React.useState([]),
      [view, setView] = React.useState("active"),
      [search, setSearch] = React.useState(""),
      [status, setStatus] = React.useState("all"),
      [loading, setLoading] = React.useState(true),
      [failure, setFailure] = React.useState(""),
      [pending, setPending] = React.useState(null),
      [busy, setBusy] = React.useState(false),
      [revision, setRevision] = React.useState(0),
      [selected, setSelected] = React.useState(new Set()),
      [bulkOperation, setBulkOperation] = React.useState(null);
    React.useEffect(() => {
      const reload = () => setRevision((v) => v + 1);
      window.addEventListener("flex-commerce-changed", reload);
      return () => window.removeEventListener("flex-commerce-changed", reload);
    }, []);
    React.useEffect(() => {
      const abort = new AbortController();
      setLoading(true);
      setFailure("");
      request(
        root + "/" + kind + "?view=" + view,
        "GET",
        undefined,
        abort.signal,
      )
        .then((r) => setRows(r.records))
        .catch((e) => {
          if (!abort.signal.aborted) setFailure(e.message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
      return () => abort.abort();
    }, [kind, view, revision]);
    React.useEffect(() => {
      setSelected(new Set());
    }, [kind, view, search, status]);
    async function bulkAction(operation, ids = [...selected]) {
      if (busy || !ids.length) return;
      setBusy(true);
      setBulkOperation(operation);
      setFailure("");
      const completed = [];
      try {
        for (const id of ids) {
          const row = rows.find((r) => r.id === id);
          if (!row) continue;
          if (["active", "inactive", "draft"].includes(operation)) {
            const result = await request(root + "/" + kind + "/" + id, "GET");
            await request(root + "/" + kind + "/" + id, "PUT", {
              ...result.record,
              status: operation,
            });
          } else {
            await request(
              root +
                "/" +
                kind +
                "/" +
                id +
                (operation === "trash" ? "" : "/" + operation),
              operation === "restore" ? "POST" : "DELETE",
              { version: row.version },
            );
          }
          completed.push(id);
        }
        toast.success("Обработени записи: " + completed.length + ".");
      } catch (e) {
        setFailure("Обработени записи: " + completed.length + ". " + e.message);
      } finally {
        setSelected(
          (current) =>
            new Set([...current].filter((id) => !completed.includes(id))),
        );
        setPending(null);
        setBusy(false);
        setBulkOperation(null);
        setRevision((v) => v + 1);
      }
    }
    async function action(row, operation) {
      if (busy) return;
      setBusy(true);
      try {
        await request(
          root +
            "/" +
            kind +
            "/" +
            row.id +
            (operation === "trash" ? "" : "/" + operation),
          operation === "restore" ? "POST" : "DELETE",
          { version: row.version },
        );
        setPending(null);
        window.dispatchEvent(new Event("flex-commerce-changed"));
        toast.success("Промяната е записана.");
      } catch (e) {
        setFailure(e.message);
      } finally {
        setBusy(false);
      }
    }
    const columns = [
      {
        key: "name",
        label: "Име",
        sortable: true,
        render: (r) =>
          view === "trash"
            ? r.name
            : h(
                "a",
                {
                  className: "react-page-link",
                  href: baseFor(kind) + "/" + r.id + "/edit",
                  onClick: (event) => {
                    if (
                      event.button !== 0 ||
                      event.ctrlKey ||
                      event.metaKey ||
                      event.shiftKey ||
                      event.altKey
                    )
                      return;
                    event.preventDefault();
                    navigate(baseFor(kind) + "/" + r.id + "/edit");
                  },
                },
                r.name,
              ),
      },
      { key: "slug", label: "Идентификатор", sortable: true },
      ...(kind === "products"
        ? [
            { key: "sku", label: "SKU", sortable: true },
            {
              key: "price_minor",
              label: "Цена",
              sortable: true,
              render: (r) =>
                r.sale_price
                  ? r.sale_price +
                    " " +
                    r.currency +
                    " (редовна: " +
                    r.price +
                    ")"
                  : r.price + " " + r.currency,
            },
            { key: "stock", label: "Наличност", sortable: true },
            {
              key: "sold",
              label: "Продадени бройки",
              sortable: true,
              sortValue: (row) => Number(row.sold ?? 0),
              render: (row) => row.sold ?? 0,
            },
          ]
        : []),
      {
        key: "status",
        label: "Статус",
        sortable: true,
        render: (r) =>
          h(
            "span",
            { className: "react-status-badge status-" + r.status },
            statuses[r.status],
          ),
      },
      {
        key: "actions",
        label: "Действия",
        render: (r) =>
          h(
            C.TableActionsMenu,
            null,
            ...(view === "active"
              ? [
                  h(
                    C.DropdownOption,
                    {
                      onClick: () =>
                        navigate(baseFor(kind) + "/" + r.id + "/edit"),
                      disabled: busy,
                    },
                    "Редактирай",
                  ),
                  h(
                    C.DropdownOption,
                    {
                      onClick: () => setPending({ row: r, operation: "trash" }),
                      disabled: busy,
                    },
                    "Премести в кошчето",
                  ),
                ]
              : [
                  h(
                    C.DropdownOption,
                    { onClick: () => action(r, "restore"), disabled: busy },
                    "Възстанови",
                  ),
                  h(
                    C.DropdownOption,
                    {
                      onClick: () => setPending({ row: r, operation: "force" }),
                      disabled: busy,
                    },
                    "Изтрий завинаги",
                  ),
                ]),
          ),
      },
    ];
    const title = kind === "products" ? "Продукти" : "Категории";
    return h(
      React.Fragment,
      null,
      h(Heading, {
        title,
        kind,
        navigate,
        action: button(
          kind === "products" ? "Създай продукт" : "Създай категория",
          () => navigate(baseFor(kind) + "/create"),
        ),
      }),
      error(failure),
      h(C.DataTable, {
        data: rows.filter(
          (r) =>
            (r.name + " " + r.slug + " " + (r.sku || ""))
              .toLocaleLowerCase("bg")
              .includes(search.toLocaleLowerCase("bg")) &&
            (status === "all" || r.status === status),
        ),
        columns,
        selectable: !busy && !loading,
        selectedKeys: selected,
        onSelectionChange: setSelected,
        bulkActions: h(
          React.Fragment,
          null,
          h("strong", null, selected.size + " избрани"),
          ...(view === "active"
            ? [
                ["active", "Активирай"],
                ["inactive", "Деактивирай"],
                ["draft", "Върни в чернова"],
                ["trash", "Премести в кошчето"],
              ]
            : [
                ["restore", "Възстанови"],
                ["force", "Изтрий завинаги"],
              ]
          ).map(([operation, label]) =>
            h(
              C.LoadingButton,
              {
                key: operation,
                type: "button",
                loading: bulkOperation === operation,
                disabled: selected.size === 0 || busy || loading,
                onClick: () =>
                  ["trash", "force"].includes(operation)
                    ? setPending({ ids: [...selected], operation })
                    : bulkAction(operation),
              },
              label,
            ),
          ),
        ),
        rowKey: (r) => r.id,
        loading,
        emptyMessage: "Няма намерени записи.",
        filterStorageKey: "flex-commerce-" + kind,
        toolbar: h(
          React.Fragment,
          null,
          h(Select, {
            label: "Изглед",
            value: view,
            options: { active: "Активни записи", trash: "Кошче" },
            onChange: setView,
          }),
          h(Select, {
            key: "status",
            label: "Статус",
            value: status,
            options: { all: "Всички статуси", ...statuses },
            onChange: setStatus,
          }),
          h(Field, {
            label: "Търсене",
            value: search,
            onChange: (e) => setSearch(e.target.value),
            placeholder: "Име, идентификатор или SKU…",
          }),
        ),
      }),
      h(C.ConfirmDialog, {
        open: !!pending,
        title:
          pending?.operation === "force"
            ? "Окончателно изтриване"
            : "Преместване в кошчето",
        message: pending?.ids
          ? "Потвърдете действието за " +
            pending.ids.length +
            " избрани записа."
          : "Потвърдете действието за „" + (pending?.row?.name || "") + "“.",
        busy,
        confirmLabel:
          pending?.operation === "force"
            ? "Изтрий завинаги"
            : "Премести в кошчето",
        onCancel: () => {
          if (!busy) setPending(null);
        },
        onConfirm: () =>
          pending &&
          (pending.ids
            ? bulkAction(pending.operation, pending.ids)
            : action(pending.row, pending.operation)),
      }),
    );
  }
  function Editor({ kind, id, navigate }) {
    const [record, setRecord] = React.useState(blank),
      [categories, setCategories] = React.useState([]),
      [loading, setLoading] = React.useState(true),
      [failure, setFailure] = React.useState(""),
      [saving, setSaving] = React.useState(false),
      [picker, setPicker] = React.useState(false),
      [drag, setDrag] = React.useState(null),
      [drop, setDrop] = React.useState(null),
      [editingId, setEditingId] = React.useState(null);
    const mediaById = new Map(record.media.map((media) => [media.id, media]));
    const changed = host.useWorkspaceChanged(),
      saved = host.useWorkspaceSaved();
    // Panels of other plugins (for example Flex SEO) in the editor; available on Flex CMS 0.1.59+.
    const saves = host.usePanelSaves ? host.usePanelSaves() : null;
    const panelType = kind === "products" ? "product" : "category";
    const panelContext = React.useMemo(
      () => ({ type: panelType, id: id ? Number(id) : null, values: record }),
      [panelType, id, record],
    );
    React.useEffect(() => {
      const abort = new AbortController();
      setLoading(true);
      Promise.all([
        id
          ? request(
              root + "/" + kind + "/" + id,
              "GET",
              undefined,
              abort.signal,
            )
          : Promise.resolve({ record: blank() }),
        kind === "products"
          ? request(root + "/categories", "GET", undefined, abort.signal)
          : Promise.resolve({ records: [] }),
      ])
        .then(async ([r, c]) => {
          if (!id && kind === "products") {
            const result = await request(
              root + "/settings",
              "GET",
              undefined,
              abort.signal,
            );
            if (result.settings)
              r.record = {
                ...r.record,
                currency: result.settings.currency,
                stock: result.settings.default_stock,
                status: result.settings.default_status,
              };
          }
          if (abort.signal.aborted) return;
          setRecord(r.record);
          setCategories(c.records);
        })
        .catch((e) => {
          if (!abort.signal.aborted) setFailure(e.message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
      return () => abort.abort();
    }, [kind, id]);
    function update(values) {
      if (saving) return;
      setRecord((r) => ({ ...r, ...values }));
      changed?.();
    }
    async function submit(e) {
      e.preventDefault();
      if (saving) return;
      setSaving(true);
      setFailure("");
      try {
        const r = await request(
          root + "/" + kind + (id ? "/" + id : ""),
          id ? "PUT" : "POST",
          record,
        );
        setRecord(r.record);
        let panelFailure = "";
        try {
          await saves?.run({ id: r.record.id });
        } catch (error) {
          panelFailure = error.message;
        }
        saved?.();
        window.dispatchEvent(new Event("flex-commerce-changed"));
        if (panelFailure === "") toast.success("Записано успешно.");
        else {
          setFailure(panelFailure);
          toast.error("Записът е запазен, но разширение не записа данните си: " + panelFailure);
          changed?.();
        }
        if (!id) navigate(baseFor(kind) + "/" + r.record.id + "/edit");
      } catch (e) {
        setFailure(e.message);
      } finally {
        setSaving(false);
      }
    }
    const field = (key, label, hint, props = {}) =>
      h(Field, {
        key,
        label,
        hint,
        value: record[key] ?? "",
        onChange: (e) => update({ [key]: e.target.value }),
        ...props,
      });
    const section = (title, key, children) =>
      h(
        C.CollapsibleSection,
        {
          title,
          storageKey: "commerce-" + key,
          defaultOpen: true,
          icon: icons.Settings,
        },
        h("div", { className: "react-form-grid" }, children),
      );
    function selectImages(media, mode) {
      let merged = [...new Set([...record.images, ...media.map((m) => m.id)])];
      if (merged.length > 200) {
        toast.error("Разрешени са до 200 изображения.");
        return;
      }
      let primary = record.primary_image_id;
      if (mode === "primary") {
        primary = media[0]?.id ?? primary;
        merged = [primary, ...merged.filter((id) => id !== primary)].filter(
          Boolean,
        );
      }
      update({
        primary_image_id: primary,
        images: merged,
        image_details: Object.fromEntries(
          merged.map((id) => {
            const item =
              media.find((m) => m.id === id) ||
              record.media.find((m) => m.id === id);
            return [
              id,
              record.image_details?.[id] || {
                alt: (item?.alt || "").slice(0, 500),
                caption: (item?.caption || "").slice(0, 1000),
                title: (item?.title || "").slice(0, 500),
                link: "",
                description: (item?.description || "").slice(0, 3000),
              },
            ];
          }),
        ),
        media: [
          ...new Map(
            [...record.media, ...media].map((m) => [m.id, m]),
          ).values(),
        ],
      });
      setPicker(false);
    }
    const renderImage = (mediaId, index) => {
      const media = mediaById.get(mediaId);
      const move = (to) => {
        const images = [...record.images];
        if (to < (record.primary_image_id ? 1 : 0) || to >= images.length)
          return;
        images.splice(to, 0, images.splice(index, 1)[0]);
        update({ images });
      };
      return h(
        "div",
        {
          key: mediaId,
          className: `commerce-image${mediaId === record.primary_image_id ? " is-primary" : ""}${drag === index ? " is-dragging" : ""}${drop?.index === index ? " is-drop-" + drop.side : ""}`,
          draggable:
            mediaId !== record.primary_image_id &&
            !saving &&
            !record.deleted_at,
          onDragStart: (event) => {
            if (
              mediaId === record.primary_image_id ||
              event.target.closest?.("button")
            ) {
              event.preventDefault();
              return;
            }
            setDrag(index);
            event.dataTransfer.setData("text/plain", String(index));
            event.dataTransfer.effectAllowed = "move";
          },
          onDragEnd: () => {
            setDrag(null);
            setDrop(null);
          },
          onDragOver: (event) => {
            if (drag === null || mediaId === record.primary_image_id) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            const bounds = event.currentTarget.getBoundingClientRect();
            const side =
              event.clientX > bounds.left + bounds.width / 2
                ? "after"
                : "before";
            setDrop((previous) =>
              previous?.index === index && previous.side === side
                ? previous
                : { index, side },
            );
          },
          onDrop: (event) => {
            event.preventDefault();
            if (
              drag !== null &&
              drop?.index === index &&
              mediaId !== record.primary_image_id
            ) {
              let target = index + (drop.side === "after" ? 1 : 0);
              if (drag < target) target--;
              const images = [...record.images];
              images.splice(target, 0, images.splice(drag, 1)[0]);
              if (
                target !== drag &&
                target >= (record.primary_image_id ? 1 : 0)
              )
                update({ images });
            }
            setDrag(null);
            setDrop(null);
          },
        },
        editingId === mediaId &&
          h(
            C.Dialog,
            {
              title:
                index + 1 + ". " + (media?.title || "Изображение " + mediaId),
              open: editingId === mediaId,
              onClose: () => setEditingId(null),
            },
            h(
              "div",
              { className: "commerce-image-fields" },
              ...[
                [
                  "alt",
                  "Alt текст",
                  500,
                  "Описва изображението за достъпност и търсачки.",
                ],
                ["caption", "Надпис", 1000],
                ["title", "Заглавие (title атрибут)", 500],
                [
                  "link",
                  "Връзка (по желание)",
                  2000,
                  "Локален адрес или пълен HTTP/HTTPS URL.",
                ],
                ["description", "Описание", 3000],
              ].map(([key, label, maxLength, hint]) =>
                h(Field, {
                  key,
                  label,
                  maxLength,
                  hint,
                  multiline: key === "description",
                  disabled: saving || !!record.deleted_at,
                  value:
                    record.image_details?.[mediaId]?.[key] ??
                    (key === "link"
                      ? ""
                      : (media?.[key] || "").slice(0, maxLength)),
                  onChange: (event) =>
                    update({
                      image_details: {
                        ...record.image_details,
                        [mediaId]: {
                          ...record.image_details?.[mediaId],
                          [key]: event.target.value,
                        },
                      },
                    }),
                }),
              ),
              button("Готово", () => setEditingId(null)),
              h(
                "small",
                { className: "react-field-hint" },
                "Текстовете са копирани от медийната библиотека. Промените важат само за този продукт и се записват с бутона Запази.",
              ),
            ),
          ),
        h("img", {
          src:
            media?.thumbnail_url ||
            media?.url ||
            "/media-files/" + mediaId + "/original",
          alt: media?.title || "",
          loading: "lazy",
          decoding: "async",
          width: 400,
          height: 300,
          draggable: false,
        }),
        h(
          "span",
          null,
          mediaId === record.primary_image_id
            ? "Основно изображение"
            : "Изображение " + (index + 1),
        ),
        mediaId !== record.primary_image_id &&
          button(
            "Направи основно",
            () =>
              update({
                primary_image_id: mediaId,
                images: [
                  mediaId,
                  ...record.images.filter((id) => id !== mediaId),
                ],
              }),
            { className: "commerce-make-primary" },
          ),
        h(
          "div",
          {
            className: "react-button-row commerce-image-actions",
          },
          button(h(icons.Settings), () => setEditingId(mediaId), {
            "aria-label": "Редактирай изображението",
            title: "Редактирай изображението",
          }),
          mediaId !== record.primary_image_id &&
            button(h(icons.ArrowUp), () => move(index - 1), {
              disabled: index <= (record.primary_image_id ? 1 : 0),
              "aria-label": "Премести по-напред",
            }),
          mediaId !== record.primary_image_id &&
            button(h(icons.ArrowDown), () => move(index + 1), {
              disabled: index === record.images.length - 1,
              "aria-label": "Премести назад",
            }),
          button(
            h(icons.X),
            () =>
              update({
                primary_image_id:
                  mediaId === record.primary_image_id
                    ? null
                    : record.primary_image_id,
                images: record.images.filter((v) => v !== mediaId),
              }),
            {
              "aria-label": "Премахни изображението",
              title: "Премахни изображението",
            },
          ),
        ),
      );
    };
    const title =
      (id ? "Редактиране на " : "Създаване на ") +
      (kind === "products" ? "продукт" : "категория");
    if (loading) return h("p", { role: "status" }, "Зареждане…");
    if (id && !record.id)
      return h(
        React.Fragment,
        null,
        h(Heading, { title, kind, navigate }),
        error(failure),
      );
    return h(
      React.Fragment,
      null,
      h(Heading, { title, kind, navigate }),
      error(failure),
      h(
        "form",
        { className: "react-edit-form commerce-edit-form", onSubmit: submit },
        h(
          "fieldset",
          { disabled: saving || !!record.deleted_at },
          kind === "products" &&
            section(
              "Изображения",
              "images",
              h(
                "div",
                { className: "commerce-image-picker" },
                h(
                  "div",
                  { className: "commerce-image-group" },
                  h("h3", null, "Основно изображение"),
                  button(
                    record.primary_image_id
                      ? "Смени основното изображение"
                      : "Избери или качи основно изображение",
                    () => setPicker("primary"),
                  ),
                  !record.primary_image_id &&
                    h(
                      "p",
                      { className: "react-field-hint" },
                      "Изберете едно изображение за лицето на продукта.",
                    ),
                ),
                h(
                  "p",
                  { className: "react-field-hint" },
                  "Можете да качвате нови файлове или да избирате изображения от медийната библиотека.",
                ),
                h(
                  "div",
                  { className: "commerce-images" },
                  ...(record.primary_image_id
                    ? [
                        renderImage(
                          record.primary_image_id,
                          record.images.indexOf(record.primary_image_id),
                        ),
                      ]
                    : []),
                ),
                h(
                  "div",
                  { className: "commerce-image-group" },
                  h("h3", null, "Допълнителни изображения"),
                  button("Добави или качи допълнителни изображения", () =>
                    setPicker("additional"),
                  ),
                  h(
                    "p",
                    { className: "react-field-hint" },
                    "Изберете няколко изображения. Влачете ги за подреждане или използвайте стрелките.",
                  ),
                  h(
                    "div",
                    { className: "commerce-images" },
                    ...record.images
                      .filter((mediaId) => mediaId !== record.primary_image_id)
                      .map((mediaId) =>
                        renderImage(mediaId, record.images.indexOf(mediaId)),
                      ),
                  ),
                ),
              ),
            ),
          section("Основна информация", "basic", [
            field("name", "Име", "Името, което ще виждат посетителите.", {
              required: true,
              maxLength: 190,
            }),
            field(
              "slug",
              "Идентификатор",
              "По желание. Генерира се от името, ако остане празен.",
              { maxLength: 190 },
            ),
            h(Select, {
              key: "status",
              label: "Статус",
              value: record.status,
              options: statuses,
              onChange: (v) => update({ status: v }),
              hint: "Черновите и неактивните записи няма да се показват в публичния каталог.",
            }),
            kind === "products" &&
              h(C.CheckboxField, {
                key: "is_top",
                label: "Топ продукт",
                checked: record.is_top === true,
                onChange: (event) => update({ is_top: event.target.checked }),
                description:
                  "Показва продукта в секцията „Топ продукти“ на началната страница, когато е публикуван.",
              }),
            kind === "products"
              ? h(
                  "div",
                  {
                    className: "react-form-field commerce-product-description",
                  },
                  h("span", null, "Описание"),
                  h(C.RichTextEditor, {
                    value: record.description,
                    onChange: (description) => update({ description }),
                  }),
                  h(
                    "small",
                    { className: "react-field-hint" },
                    "Подробно описание на продукта с форматиране, изображения и връзки.",
                  ),
                )
              : field(
                  "description",
                  "Описание",
                  "Подробно описание като обикновен текст.",
                  { multiline: true, rows: 5, maxLength: 50000 },
                ),
          ]),
          kind === "products" &&
            section("Цена и наличност", "stock", [
              field("sku", "SKU", "Уникален продуктов код, по желание.", {
                maxLength: 100,
              }),
              field(
                "price",
                "Цена",
                "Сума с до две цифри след десетичния знак.",
                { required: true, inputMode: "decimal" },
              ),
              field(
                "sale_price",
                "Промоционална цена",
                "По-ниска от редовната цена. Оставете празно, за да премахнете промоцията.",
                { inputMode: "decimal" },
              ),
              h(Select, {
                key: "currency",
                label: "Валута",
                value: record.currency,
                options: { EUR: "EUR", BGN: "BGN", USD: "USD" },
                onChange: (v) => update({ currency: v }),
                hint: "Валута на цената. Общата валута на магазина ще бъде добавена с checkout-а.",
              }),
              field("stock", "Наличност", "Брой налични единици.", {
                type: "number",
                min: 0,
                max: 1000000,
                step: 1,
                required: true,
              }),
            ]),
          kind === "products" &&
            section(
              "Категории",
              "categories",
              categories.length || record.category_ids.length
                ? h(
                    "div",
                    null,
                    ...categories.map((c) =>
                      h(C.CheckboxField, {
                        key: c.id,
                        label: c.name,
                        checked: record.category_ids.includes(c.id),
                        onChange: (event) =>
                          update({
                            category_ids: event.target.checked
                              ? [...record.category_ids, c.id]
                              : record.category_ids.filter((v) => v !== c.id),
                          }),
                      }),
                    ),
                    ...record.category_ids
                      .filter((id) => !categories.some((c) => c.id === id))
                      .map((id) =>
                        h(C.CheckboxField, {
                          key: id,
                          label: "Категория #" + id + " (в кошчето)",
                          checked: true,
                          onChange: () =>
                            update({
                              category_ids: record.category_ids.filter(
                                (v) => v !== id,
                              ),
                            }),
                        }),
                      ),
                  )
                : h(
                    "p",
                    null,
                    "Създайте категория от раздел „Категории“.",
                  ),
            ),
          C.ExtensionPanels &&
            h(C.ExtensionPanels, {
              location: "commerce." + panelType + ".editor",
              context: panelContext,
              saves,
            }),
          h(
            "div",
            { className: "react-form-actions" },
            h(
              C.LoadingButton,
              { type: "submit", loading: saving, icon: h(icons.Save) },
              saving ? "Запазване…" : "Запази",
            ),
          ),
        ),
        record.deleted_at &&
          h(
            "p",
            { role: "status" },
            "Възстановете записа от кошчето преди редактиране.",
          ),
      ),
      h(C.MediaPicker, {
        open: !!picker,
        multiple: picker === "additional",
        imagesOnly: true,
        onClose: () => setPicker(false),
        onSelect: (media) => selectImages([media], "primary"),
        onSelectMany: (media) => selectImages(media, "additional"),
      }),
    );
  }
  function SalesPage({ navigate }) {
    const [report, setReport] = React.useState({ ranking: [], sales: [] }),
      [products, setProducts] = React.useState([]),
      [loading, setLoading] = React.useState(true),
      [saving, setSaving] = React.useState(false),
      [failure, setFailure] = React.useState(""),
      [pending, setPending] = React.useState(null),
      [form, setForm] = React.useState({
        product_id: "",
        quantity: 1,
        reference: "",
      });
    React.useEffect(() => {
      const abort = new AbortController();
      Promise.all([
        request(root + "/sales", "GET", undefined, abort.signal),
        request(root + "/products", "GET", undefined, abort.signal),
      ])
        .then(([data, list]) => {
          setReport(data);
          setProducts(list.records);
        })
        .catch((e) => {
          if (!abort.signal.aborted) setFailure(e.message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
      return () => abort.abort();
    }, []);
    async function save(event) {
      event.preventDefault();
      if (saving) return;
      setSaving(true);
      setFailure("");
      try {
        setReport(await request(root + "/sales", "POST", form));
        setForm({ ...form, reference: "", quantity: 1 });
        toast.success("Продажбата е отчетена.");
      } catch (e) {
        setFailure(e.message);
      } finally {
        setSaving(false);
      }
    }
    async function changeStatus() {
      if (saving || !pending) return;
      setSaving(true);
      setFailure("");
      try {
        setReport(
          await request(root + "/sales/" + pending.id, "PUT", {
            cancelled: !pending.cancelled,
          }),
        );
        setPending(null);
        toast.success("Статусът е обновен.");
      } catch (e) {
        setFailure(e.message);
      } finally {
        setSaving(false);
      }
    }
    return h(
      React.Fragment,
      null,
      h(
        "div",
        { className: "react-page-heading" },
        h(
          "div",
          null,
          h("h1", null, "Продажби"),
          h(C.Breadcrumbs, {
            items: [{ label: "Продажби" }],
            onHomeClick: () => navigate("/"),
          }),
        ),
      ),
      error(failure),
      h(
        "div",
        { className: "commerce-sales-admin" },
      h(
        C.CollapsibleSection,
        {
          title: "Най-продавани продукти",
          icon: icons.Settings,
          storageKey: "commerce-sales-ranking",
        },
        h(
          "div",
          { className: "commerce-sales-section" },
        h(
          "p",
          { className: "react-field-hint" },
          "Класация по общо продадени бройки за целия период. Анулираните продажби са изключени.",
        ),
        h(C.DataTable, {
          data: report.ranking,
          rowKey: (row) => row.id,
          loading,
          columns: [
            {
              key: "name",
              label: "Продукт",
              render: (r) =>
                h(
                  "a",
                  {
                    className: "react-page-link",
                    href: baseFor("products") + "/" + r.id + "/edit",
                    onClick: (e) => {
                      e.preventDefault();
                      navigate(baseFor("products") + "/" + r.id + "/edit");
                    },
                  },
                  r.name,
                ),
            },
            {
              key: "sold",
              label: "Продадени бройки",
              sortable: true,
              sortValue: (row) => Number(row.sold),
            },
            {
              key: "status",
              label: "Статус",
              render: (r) => statuses[r.status],
            },
          ],
        }),
        ),
      ),
      h(
        C.CollapsibleSection,
        {
          title: "Отчитане на потвърдена продажба",
          icon: icons.Settings,
          storageKey: "commerce-sales-create",
        },
        h(
          "div",
          { className: "commerce-sales-section" },
        h(
          "p",
          { className: "react-field-hint" },
          "Отчитайте само завършени продажби. Номерът на поръчката предотвратява дублиране. Този регистър не променя наличността; добавянето в количката не се отчита като продажба.",
        ),
        h(
          "form",
          { className: "commerce-sales-form", onSubmit: save },
          h(
            "fieldset",
            { disabled: saving || loading },
            h(
              "div",
              { className: "react-form-grid" },
              h(Select, {
                label: "Продукт",
                value: String(form.product_id),
                options: Object.fromEntries([
                  ["", "Изберете продукт"],
                  ...products.map((p) => [String(p.id), p.name]),
                ]),
                onChange: (v) => setForm({ ...form, product_id: v }),
              }),
              h(Field, {
                label: "Продадено количество",
                type: "number",
                min: 1,
                max: 1000000,
                step: 1,
                required: true,
                value: form.quantity,
                onChange: (e) => setForm({ ...form, quantity: e.target.value }),
              }),
              h(Field, {
                label: "Номер на поръчка",
                maxLength: 100,
                required: true,
                value: form.reference,
                onChange: (e) =>
                  setForm({ ...form, reference: e.target.value }),
              }),
            ),
            h(
              "div",
              { className: "react-form-actions" },
              h(
                C.LoadingButton,
                { type: "submit", loading: saving, icon: h(icons.Save) },
                "Отчети продажбата",
              ),
            ),
          ),
        ),
        ),
      ),
      h(
        C.CollapsibleSection,
        {
          title: "Последни 100 отчетени продажби",
          icon: icons.Settings,
          storageKey: "commerce-sales-history",
        },
        h(C.DataTable, {
          data: report.sales,
          rowKey: (row) => row.id,
          loading,
          columns: [
            { key: "reference", label: "Поръчка" },
            { key: "name", label: "Продукт" },
            { key: "quantity", label: "Бройки" },
            {
              key: "created_at",
              label: "Дата",
              render: (r) => when(r.created_at),
              sortValue: (r) => whenSort(r.created_at),
            },
            {
              key: "cancelled",
              label: "Статус",
              render: (r) => (r.cancelled ? "Анулирана" : "Потвърдена"),
            },
            {
              key: "actions",
              label: "Действия",
              render: (r) =>
                h(
                  C.LoadingButton,
                  {
                    type: "button",
                    disabled: saving,
                    onClick: () => setPending(r),
                  },
                  r.cancelled ? "Възстанови" : "Анулирай",
                ),
            },
          ],
        }),
      ),
      ),
      h(C.ConfirmDialog, {
        open: !!pending,
        title: pending?.cancelled
          ? "Възстановяване на продажба"
          : "Анулиране на продажба",
        message:
          "Промяната ще се отрази на класацията за най-продавани продукти.",
        busy: saving,
        confirmLabel: "Потвърди",
        onConfirm: changeStatus,
        onCancel: () => {
          if (!saving) setPending(null);
        },
      }),
    );
  }
  function SettingsPage({ navigate }) {
    const [settings, setSettings] = React.useState(null),
      [saving, setSaving] = React.useState(false),
      [failure, setFailure] = React.useState("");
    const changed = host.useWorkspaceChanged(),
      saved = host.useWorkspaceSaved();
    React.useEffect(() => {
      const abort = new AbortController();
      request(root + "/settings", "GET", undefined, abort.signal)
        .then((result) => setSettings(result.settings))
        .catch((error) => {
          if (!abort.signal.aborted) setFailure(error.message);
        });
      return () => abort.abort();
    }, []);
    const update = (patch) => {
      setSettings((value) => ({ ...value, ...patch }));
      changed();
    };
    async function submit(event) {
      event.preventDefault();
      if (saving || !settings) return;
      setSaving(true);
      setFailure("");
      try {
        const result = await request(root + "/settings", "PUT", settings);
        setSettings(result.settings);
        saved();
        toast.success("Настройките на магазина са запазени.");
      } catch (error) {
        setFailure(error.message);
      } finally {
        setSaving(false);
      }
    }
    return h(
      React.Fragment,
      null,
      h(
        "div",
        { className: "react-page-heading" },
        h(
          "div",
          null,
          h("h1", null, "Настройки"),
          h(C.Breadcrumbs, {
            items: [
              {
                label: "Продукти",
                onClick: () => navigate(baseFor("products")),
              },
              { label: "Настройки" },
            ],
          }),
        ),
      ),
      error(failure),
      !settings
        ? h(
            "p",
            { role: "status" },
            failure ? "Настройките не могат да бъдат заредени." : "Зареждане…",
          )
        : h(
            "form",
            {
              className: "react-edit-form commerce-edit-form",
              onSubmit: submit,
            },
            h(
              "fieldset",
              { disabled: saving },
              h(
                C.CollapsibleSection,
                {
                  title: "Основни настройки",
                  icon: icons.Settings,
                  storageKey: "commerce-settings-general",
                },
                h(
                  "div",
                  { className: "react-form-grid" },
                  h(Select, {
                    label: "Основна валута",
                    value: settings.currency,
                    options: {
                      EUR: "Евро (EUR)",
                      BGN: "Български лев (BGN)",
                      USD: "Щатски долар (USD)",
                    },
                    onChange: (currency) => update({ currency }),
                    hint: "Използва се за новите продукти. Цените и валутите на съществуващите продукти не се преобразуват.",
                  }),
                  h(Field, {
                    label: "Наличност по подразбиране",
                    type: "number",
                    min: 0,
                    max: 1000000,
                    step: 1,
                    required: true,
                    value: settings.default_stock,
                    onChange: (event) =>
                      update({ default_stock: event.target.value }),
                    hint: "Начална наличност за нов продукт. Може да се променя за всеки продукт.",
                  }),
                  h(Select, {
                    label: "Статус на новите продукти",
                    value: settings.default_status,
                    options: statuses,
                    onChange: (default_status) => update({ default_status }),
                    hint: "Препоръчително е новите продукти да започват като чернови, докато попълните данните им.",
                  }),
                ),
              ),
              h(
                C.CollapsibleSection,
                {
                  title: "Продуктова страница",
                  icon: icons.Settings,
                  storageKey: "commerce-settings-product-page",
                },
                h(
                  "div",
                  { className: "react-form-grid" },
                  h(Select, {
                    label: "Дизайн на продуктовата страница",
                    value: settings.product_page_layout || "plain",
                    options: { plain: "Обикновен", boxed: "В отделен бокс" },
                    onChange: (product_page_layout) =>
                      update({ product_page_layout }),
                    hint: "Обикновеният изглед е без обща рамка. Боксът поставя снимките и информацията в бяла секция с рамка, заоблени ъгли и вътрешни отстояния. Прилага се за всички продукти.",
                  }),
                ),
              ),
              ...[
                ['Поръчки','orders',[
                  h(C.CheckboxField,{label:'Приемане на поръчки',checked:settings.checkout_enabled,onChange:e=>update({checkout_enabled:e.target.checked})}),
                  h(C.CheckboxField,{label:'Потвърждение по имейл за клиента',checked:settings.order_email_customer,onChange:e=>update({order_email_customer:e.target.checked})}),
                  h(Field,{label:'Имейл за нови поръчки',type:'email',value:settings.order_admin_email,onChange:e=>update({order_admin_email:e.target.value}),hint:'Празно поле изключва известията за магазина.'}),
                  h(Field,{label:'Страница с условия за покупка',value:settings.terms_url,onChange:e=>update({terms_url:e.target.value}),hint:'Локален адрес или пълен HTTP/HTTPS URL.'}),
                  h(Field,{label:'Политика за поверителност',value:settings.privacy_url,onChange:e=>update({privacy_url:e.target.value})})
                ]],
                ['Доставка','shipping',[
                  h(Select,{label:'Режим на доставка',value:settings.shipping_mode||'fixed',options:{fixed:'Фиксирана цена',econt:'Еконт (автоматично изчисление)'},onChange:shipping_mode=>update({shipping_mode}),hint:'Фиксираната цена ползва сумите по-долу. При Еконт цената се изчислява от системата на Еконт чрез плъгина Flex Econt.'}),
                  ...(settings.shipping_mode==='econt'?[
                    h('p',{className:'react-field-hint'},'Конфигурирайте достъпа и подателя в Магазин → Еконт. В checkout клиентът избира офис или адрес, а цената идва от Еконт.')
                  ]:[
                    h(Field,{label:'Цена за доставка ('+settings.currency+')',type:'number',min:0,step:'0.01',required:true,value:settings.shipping_price ?? settings.shipping_minor/100,onChange:e=>update({shipping_price:e.target.value,shipping_minor:Math.round(Number(e.target.value)*100)}),hint:'Фиксирана цена за доставка до адрес.'}),
                    h(Field,{label:'Безплатна доставка над ('+settings.currency+')',type:'number',min:0,step:'0.01',required:true,value:settings.free_shipping_price ?? settings.free_shipping_minor/100,onChange:e=>update({free_shipping_price:e.target.value,free_shipping_minor:Math.round(Number(e.target.value)*100)}),hint:'0 изключва безплатната доставка по праг.'})
                  ]),
                  h(Field,{label:'Страница с условия за доставка',value:settings.shipping_terms_url,onChange:e=>update({shipping_terms_url:e.target.value}),hint:'Показва се на продуктовата страница и в бързия преглед. Локален адрес или пълен HTTP/HTTPS URL.'})
                ]],
                ['Плащания','payments',[
                  h(C.CheckboxField,{label:'Наложен платеж',checked:settings.cod_enabled,onChange:e=>update({cod_enabled:e.target.checked})}),
                  h('p',{className:'react-field-hint'},'Плащане при получаване. Онлайн плащания и куриерски офиси ще бъдат добавени с отделни интеграции.')
                ]]
              ].map(([title,key,children])=>h(C.CollapsibleSection,{key,title,icon:icons.Settings,storageKey:'commerce-settings-'+key},h('div',{className:'react-form-grid'},...children))),
              h(
                "div",
                { className: "react-form-actions" },
                h(
                  C.LoadingButton,
                  { type: "submit", loading: saving, icon: h(icons.Save) },
                  "Запази настройките",
                ),
              ),
            ),
          ),
    );
  }
  return function CommercePage({ path, navigate }) {
    const kind = path.startsWith(baseFor("categories"))
        ? "categories"
        : "products",
      match = path.match(/\/(\d+)\/edit$/);
    return h(
      React.Fragment,
      null,
      h("link", {
        rel: "stylesheet",
        href: "/extensions/flex/commerce/assets/assets/commerce.css?v=sales-spacing",
      }),
      path === baseFor("orders") ? h(OrdersPage, { navigate }) : path === baseFor("sales")
        ? h(SalesPage, { navigate })
        : path === baseFor("settings")
          ? h(SettingsPage, { navigate })
          : path === baseFor(kind)
            ? h(List, { key: kind, kind, navigate })
            : h(Editor, {
                key: path,
                kind,
                id: match ? Number(match[1]) : null,
                navigate,
              }),
    );
  };
}

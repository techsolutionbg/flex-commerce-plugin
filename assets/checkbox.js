/**
 * Shared storefront checkbox for React createElement trees.
 * Markup matches templates/components/checkbox.twig and theme .flex-checkbox styles.
 */
export function createCheckbox(h) {
  if (typeof h !== "function") {
    throw new TypeError("createCheckbox requires React.createElement");
  }
  return function Checkbox(props) {
    const {
      name,
      value = "1",
      checked = false,
      disabled = false,
      required = false,
      invalid = false,
      id,
      className = "",
      onChange,
      children,
      label,
    } = props;
    const content =
      children !== undefined && children !== null
        ? children
        : label !== undefined
          ? label
          : null;
    const labelChildren = Array.isArray(content)
      ? content
      : content === null || content === undefined
        ? []
        : [content];
    return h(
      "label",
      { className: "flex-checkbox" + (className ? " " + className : "") },
      h("input", {
        type: "checkbox",
        className: "flex-checkbox__input",
        id,
        name,
        value,
        checked,
        disabled,
        required,
        "aria-invalid": invalid || undefined,
        onChange,
      }),
      h("span", { className: "flex-checkbox__control", "aria-hidden": true }),
      h("span", { className: "flex-checkbox__label" }, ...labelChildren),
    );
  };
}

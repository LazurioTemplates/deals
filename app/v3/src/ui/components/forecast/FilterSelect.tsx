import { Icon } from "design-system/react";

/** A filter of a page as a select: „all“ first, then the options; named for screen readers. */
export function FilterSelect({
  label,
  all,
  value,
  options,
  onChange,
}: {
  label: string;
  all: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  onChange: (value: string | undefined) => void;
}) {
  return (
    <label className="forecast-filter">
      <span className="ds-visually-hidden">{label}</span>
      <span className="ds-select-wrap">
        <select
          className="ds-select"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value || undefined)}
        >
          <option value="">{all}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Icon name="nav-arrow-down" className="ds-select__chevron" />
      </span>
    </label>
  );
}

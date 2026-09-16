import { useEffect, useId, useRef, useState } from "react";
import { Avatar } from "./Avatar";
export interface SelectOption {
  value: string;
  label: string;
  avatar?: string;
}
export function SearchSelect({
  label,
  value,
  options,
  onChange,
  allowLogin = false,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  allowLogin?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    input = useRef<HTMLInputElement>(null);
  const id = useId();
  const filtered = options.filter(
    (o) =>
      !query ||
      o.label.toLowerCase().includes(query.toLowerCase()) ||
      o.value.toLowerCase().includes(query.toLowerCase()),
  );
  const login = query.trim().replace(/^@/, "");
  if (
    allowLogin &&
    /^[a-zA-Z0-9-]+(?:\[bot\])?$/.test(login) &&
    !filtered.some((o) => o.value.toLowerCase() === login.toLowerCase())
  )
    filtered.push({
      value: login,
      label: `Buscar PRs de @${login}`,
      avatar: login,
    });
  const selected = options.find((o) => o.value === value) ?? {
    value,
    label: value ? `@${value}` : (options[0]?.label ?? ""),
    avatar: allowLogin && value ? value : undefined,
  };
  function choose(next: string) {
    onChange(next);
    setOpen(false);
    trigger.current?.focus();
  }
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (open)
      document
        .getElementById(`${id}-option-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open, id]);
  return (
    <div className="search-select" ref={root}>
      <span className="select-label" id={`${id}-label`}>
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        className={`select-trigger ${open ? "expanded" : ""}`}
        role="combobox"
        aria-label={label}
        aria-controls={`${id}-list`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          setOpen((v) => !v);
          setQuery("");
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            setQuery("");
            setActive(0);
          }
        }}
      >
        {selected.avatar && <Avatar login={selected.avatar} size={20} />}
        <span>{selected.label}</span>
        <span className="select-chevron" aria-hidden="true">
          ⌄
        </span>
      </button>
      {open && (
        <div className="select-popover">
          <div className="select-search">
            <span aria-hidden="true">⌕</span>
            <input
              ref={input}
              aria-label={`Buscar em ${label}`}
              placeholder="Buscar…"
              value={query}
              role="combobox"
              aria-controls={`${id}-list`}
              aria-expanded="true"
              aria-autocomplete="list"
              aria-activedescendant={
                filtered[active] ? `${id}-option-${active}` : undefined
              }
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setOpen(false);
                  trigger.current?.focus();
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((i) =>
                    Math.max(0, Math.min(i + 1, filtered.length - 1)),
                  );
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((i) => Math.max(0, i - 1));
                }
                if (e.key === "Enter" && filtered[active]) {
                  e.preventDefault();
                  choose(filtered[active].value);
                }
                if (e.key === "Tab") setOpen(false);
              }}
            />
          </div>
          <div
            className="select-options"
            role="listbox"
            id={`${id}-list`}
            aria-labelledby={`${id}-label`}
          >
            {filtered.map((option, i) => (
              <button
                id={`${id}-option-${i}`}
                type="button"
                tabIndex={-1}
                role="option"
                aria-label={option.label}
                aria-selected={value === option.value}
                className={active === i ? "highlighted" : ""}
                key={option.value}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(option.value)}
              >
                {option.avatar ? (
                  <Avatar login={option.avatar} size={23} />
                ) : (
                  <span className="select-option-symbol">◇</span>
                )}
                <span>{option.label}</span>
                {value === option.value && (
                  <span className="select-check">✓</span>
                )}
              </button>
            ))}
            {!filtered.length && <p>Nenhum resultado.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

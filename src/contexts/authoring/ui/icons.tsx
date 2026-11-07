/** Small stroke icons. All are decorative; the controls that use them carry their own labels. */

const common = {
  viewBox: "0 0 16 16",
  width: 14,
  height: 14,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
} as const;

export const PlusIcon = () => (
  <svg {...common}>
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
);

export const PencilIcon = () => (
  <svg {...common}>
    <path d="M10.5 3.2l2.3 2.3-7.1 7.1-2.9.6.6-2.9z" />
  </svg>
);

export const TrashIcon = () => (
  <svg {...common}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
  </svg>
);

export const CloseIcon = () => (
  <svg {...common}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export const SidebarIcon = () => (
  <svg {...common} width={16} height={16}>
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M6.5 3v10" />
  </svg>
);

export const LanguageIcon = () => (
  <svg {...common} width={16} height={16}>
    <path d="M3 3.5h7.5a2 2 0 012 2V13l-2.2-1.6H3z" />
    <path d="M5.5 6.5h4.5M5.5 8.8h3" />
  </svg>
);

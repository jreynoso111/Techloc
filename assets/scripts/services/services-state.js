const DB_FIELD_BY_COL_ID = {
  company: 'company_name',
  authorization: 'authorization',
  category: 'category',
  verified: 'verified',
  phone: 'phone',
  contact: 'contact',
  address: 'address',
  city: 'city',
  state: 'state',
  zip: 'zip',
  email: 'email',
  notes: 'notes',
  website: 'website',
  availability: 'availability',
  lat: 'lat',
  long: 'long',
};

const ALL_COLUMNS = [
  { id: 'company', label: 'Company Name', key: 'company', defaultWidth: 220 },
  { id: 'authorization', label: 'Authorization', key: 'authorization', defaultWidth: 160 },
  { id: 'category', label: 'Category', key: 'category', defaultWidth: 170 },
  { id: 'verified', label: 'Verified', key: 'verified', defaultWidth: 120 },
  { id: 'phone', label: 'Phone', key: 'phone', defaultWidth: 150 },
  { id: 'contact', label: 'Contact', key: 'contact', defaultWidth: 160 },
  { id: 'address', label: 'Address', key: 'address', defaultWidth: 260 },
  { id: 'city', label: 'City', key: 'city', defaultWidth: 140 },
  { id: 'state', label: 'State', key: 'state', defaultWidth: 100 },
  { id: 'zip', label: 'Zip', key: 'zip', defaultWidth: 100 },
  { id: 'email', label: 'Email', key: 'email', defaultWidth: 240 },
  { id: 'notes', label: 'Notes', key: 'notes', defaultWidth: 260 },
  { id: 'website', label: 'Website', key: 'website', defaultWidth: 220 },
  { id: 'availability', label: 'Availability', key: 'availability', defaultWidth: 180 },
  { id: 'lat', label: 'Lat', key: 'lat', defaultWidth: 120 },
  { id: 'long', label: 'Long', key: 'long', defaultWidth: 120 },
];

const state = {
  rows: [],
  currentUserRole: 'user',
  currentUserId: 'anon',
  currentUserEmail: '',
  filters: { columnFilters: {} },
  sort: { key: '', dir: 'asc' },
  pagination: { page: 1, pageSize: 20 },
  columnOrder: ['actions', ...ALL_COLUMNS.map(c => c.id)],
  columnVisibility: Object.fromEntries([['actions', true], ...ALL_COLUMNS.map(c => [c.id, true])]),
  columnWidths: Object.fromEntries([['actions', 140], ...ALL_COLUMNS.map(c => [c.id, c.defaultWidth])]),
  columnLabels: {},
  drag: { resizing: null, draggingCol: null },

  // inline edit session
  inlineEdit: { td: null, rowId: null, colId: null, original: null, inputEl: null, saving: false, skipBlurCommit: false },
};

export { ALL_COLUMNS, DB_FIELD_BY_COL_ID, state };

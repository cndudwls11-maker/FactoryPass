import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(
  await readFile(resolve(root, 'tracking.config.json'), 'utf8'),
);
if (!/^G-[A-Z0-9]+$/.test(config.measurementId))
  throw new Error('Set a real GA4 measurement ID first.');
const text = (key, value) => ({ type: 'TEMPLATE', key, value });
const row = (name, value) => ({
  type: 'MAP',
  map: [text('parameter', name), text('parameterValue', value)],
});
const table = (key, values) => ({
  type: 'LIST',
  key,
  list: values.map(([name, value]) => row(name, value)),
});
const variables = [
  ['Page Location', 'page_location'],
  ['Page Referrer', 'page_referrer'],
  ['Page Title', 'page_title'],
  ['Attendance Type', 'attendance_type'],
].map(([label, name], index) => ({
  variableId: String(index + 1),
  name: 'FP - ' + label,
  type: 'v',
  parameter: [
    text('name', name),
    { type: 'INTEGER', key: 'dataLayerVersion', value: '2' },
  ],
}));
const common = [
  ['page_location', '{{FP - Page Location}}'],
  ['page_referrer', '{{FP - Page Referrer}}'],
  ['page_title', '{{FP - Page Title}}'],
];
const events = [
  ['fp_page_view', 'Page View'],
  ['login', 'Login'],
  ['qr_verified', 'QR Verified'],
  ['attendance_confirmed', 'Attendance Confirmed'],
];
const triggers = events.map(([event, label], index) => ({
  triggerId: String(index + 1),
  name: 'FP - ' + label,
  type: 'CUSTOM_EVENT',
  customEventFilter: [
    {
      type: 'EQUALS',
      parameter: [text('arg0', '{{_event}}'), text('arg1', event)],
    },
  ],
}));
const tags = [
  {
    tagId: '1',
    name: 'Google tag - FactoryPass',
    type: 'googtag',
    parameter: [
      text('tagId', config.measurementId),
      table('configSettingsTable', common),
    ],
    firingTriggerId: ['1'],
    tagFiringOption: 'ONCE_PER_LOAD',
  },
];
for (const [index, [event, label]] of events.entries()) {
  if (index === 0) continue;
  const values = [...common];
  if (event === 'login') values.push(['method', 'password']);
  if (event === 'attendance_confirmed')
    values.push(['attendance_type', '{{FP - Attendance Type}}']);
  tags.push({
    tagId: String(index + 1),
    name: 'GA4 - ' + label,
    type: 'gaawe',
    parameter: [
      text('measurementIdOverride', config.measurementId),
      text('eventName', event),
      table('eventSettingsTable', values),
    ],
    firingTriggerId: [String(index + 1)],
    tagFiringOption: 'ONCE_PER_EVENT',
  });
}
const builtInVariable = [
  ['Page URL', 'PAGE_URL'],
  ['Page Hostname', 'PAGE_HOSTNAME'],
  ['Page Path', 'PAGE_PATH'],
  ['Referrer', 'REFERRER'],
  ['Event', 'EVENT'],
].map(([name, type]) => ({ name, type }));
const container = {
  exportFormatVersion: 2,
  containerVersion: {
    container: {
      name: 'factorypass.pages.dev',
      publicId: config.containerId,
      usageContext: ['WEB'],
    },
    tag: tags,
    trigger: triggers,
    variable: variables,
    builtInVariable,
  },
};
await mkdir(resolve(root, 'analytics'), { recursive: true });
await writeFile(
  resolve(root, 'analytics/gtm-container.json'),
  JSON.stringify(container, null, 2) + '\n',
);
console.log('Prepared 4 tags, 4 triggers and 4 data-layer variables.');

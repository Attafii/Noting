export interface NoteTemplate {
  key: string;
  label: string;
  title: string;
  body: (date: Date) => string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const NOTE_TEMPLATES: NoteTemplate[] = [
  { key: 'blank', label: 'Blank note', title: 'Untitled', body: () => '' },
  {
    key: 'meeting',
    label: 'Meeting notes',
    title: 'Meeting',
    body: (d) =>
      `# Meeting — ${isoDate(d)}\n\n**Attendees:** \n\n## Agenda\n- [ ] \n\n## Notes\n\n## Actions\n- [ ] `,
  },
  {
    key: 'daily',
    label: 'Daily note',
    title: 'Daily',
    body: (d) => `# ${isoDate(d)}\n\n## Goals\n- [ ] \n\n## Notes\n\n## End of day\n`,
  },
];

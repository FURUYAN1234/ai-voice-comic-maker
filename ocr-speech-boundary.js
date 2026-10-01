const TEXT_ROLES = new Set(['dialogue', 'narration', 'story_text', 'sfx', 'page_credit']);
const PAGE_REGIONS = new Set(['panel', 'page_footer', 'page_margin']);
// Page position alone is insufficient: genuine bottom narration and story URLs remain audible.
export function filterSpeechMetadata(metadata) {
  if (!metadata || !Array.isArray(metadata.panels)) throw new Error('OCR speech metadata requires panels');
  let excluded = 0;
  const panels = metadata.panels.map(panel => ({
    ...panel,
    dialogues: (panel.dialogues || []).filter(line => {
      if (!TEXT_ROLES.has(line.textRole) || !PAGE_REGIONS.has(line.pageRegion)) {
        throw new Error('OCR text role/page region is missing or invalid; speech generation stopped');
      }
      const pageCredit = line.textRole === 'page_credit' && ['page_footer', 'page_margin'].includes(line.pageRegion);
      if (pageCredit) excluded++;
      return !pageCredit;
    }),
  }));
  return { metadata: { ...metadata, panels }, excluded };
}

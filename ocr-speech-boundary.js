const TEXT_ROLES = new Set(['dialogue', 'narration', 'story_text', 'sfx', 'page_credit']);
const PAGE_REGIONS = new Set(['panel', 'page_footer', 'page_margin']);
const PAGE_TITLE_LABEL = /^(?:題字|(?:(?:作品|漫画|ページ)の?)?タイトル(?:文字|テキスト)|(?:作品|漫画|ページ)の?タイトル|(?:page|comic|manga) title(?: text)?|title text)$/iu;

function comparableTitle(value) {
  if (typeof value !== 'string') return '';
  const unquoted = value.normalize('NFKC').trim().replace(/^[「『"“]|[」』"”]$/gu, '');
  return unquoted.replace(/\s+/gu, ' ').trim();
}

export function isDuplicatePageTitle(line, title) {
  if (typeof line.speaker !== 'string' || !PAGE_TITLE_LABEL.test(line.speaker.normalize('NFKC').trim())) {
    return false;
  }
  const normalizedTitle = comparableTitle(title);
  return normalizedTitle !== '' && comparableTitle(line.text) === normalizedTitle;
}

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
      const excludedFromSpeech = pageCredit || isDuplicatePageTitle(line, metadata.title);
      if (excludedFromSpeech) excluded++;
      return !excludedFromSpeech;
    }),
  }));
  return { metadata: { ...metadata, panels }, excluded };
}

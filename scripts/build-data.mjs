import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const PDF_NAME = 'Trắc nghiệm LSD (full đáp án).pdf';
const PDF_PATH = path.join(ROOT, PDF_NAME);
const XML_PATH = path.join(ROOT, 'full.xml');
const SVG_DIR = path.join(ROOT, '.build-svg');
const DATA_PATH = path.join(ROOT, 'data.js');
const REPORT_PATH = path.join(ROOT, 'build-report.json');
const DEBUG_QUESTIONS_PATH = path.join(ROOT, 'debug-questions.json');

if (!fs.existsSync(PDF_PATH)) {
  throw new Error(`Missing source PDF: ${PDF_NAME}`);
}

ensureArtifacts();

const xml = fs.readFileSync(XML_PATH, 'utf8');
const pages = parseXmlPages(xml);
const highlightMap = parseAllHighlights(pages);
const questions = buildQuestions(pages, highlightMap);
const examSets = buildExamSets(questions);
const report = buildReport(questions, examSets);

fs.writeFileSync(DEBUG_QUESTIONS_PATH, JSON.stringify(questions, null, 2), 'utf8');
fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

if (report.questionCount !== 370) {
  throw new Error(`Expected 370 questions, got ${report.questionCount}`);
}

if (report.questionsMissingAnswers.length > 0) {
  throw new Error(`Missing answers for ${report.questionsMissingAnswers.length} questions`);
}

if (report.questionsWithMultipleAnswers.length > 0) {
  throw new Error(`Detected multiple highlighted answers for ${report.questionsWithMultipleAnswers.length} questions`);
}

if (report.optionCountIssues.length > 0) {
  throw new Error(`Detected ${report.optionCountIssues.length} questions without 4 options`);
}

if (report.usageIssues.length > 0) {
  throw new Error(`Usage validation failed for ${report.usageIssues.length} questions`);
}

const appData = {
  meta: {
    title: 'Trac nghiem Lich su Dang',
    questionCount: questions.length,
    setCount: examSets.length,
    repeatedPerQuestion: 2,
    source: PDF_NAME,
    buildTime: new Date().toISOString(),
  },
  questions,
  examSets,
};

fs.writeFileSync(
  DATA_PATH,
  `window.APP_DATA = ${JSON.stringify(appData, null, 2)};\n`,
  'utf8',
);

console.log(`Built ${questions.length} questions into ${examSets.length} exam sets.`);
console.log(`Saved ${path.basename(DATA_PATH)} and ${path.basename(REPORT_PATH)}.`);

function ensureArtifacts() {
  if (!fs.existsSync(XML_PATH)) {
    execFileSync('pdftohtml', ['-xml', PDF_NAME, path.basename(XML_PATH)], {
      cwd: ROOT,
      stdio: 'inherit',
    });
  }

  fs.mkdirSync(SVG_DIR, { recursive: true });

  for (let pageNumber = 1; pageNumber <= 64; pageNumber += 1) {
    const svgPath = path.join(SVG_DIR, `page-${pageNumber}.svg`);
    if (fs.existsSync(svgPath)) {
      continue;
    }

    execFileSync(
      'pdftocairo',
      ['-svg', '-f', String(pageNumber), '-l', String(pageNumber), PDF_NAME, svgPath],
      {
        cwd: ROOT,
        stdio: 'inherit',
      },
    );
  }
}

function parseXmlPages(xmlText) {
  const pages = [];
  const pageRegex = /<page number="(\d+)"[^>]*height="(\d+)" width="(\d+)"[^>]*>([\s\S]*?)<\/page>/gu;

  for (const match of xmlText.matchAll(pageRegex)) {
    const pageNumber = Number(match[1]);
    const height = Number(match[2]);
    const width = Number(match[3]);
    const body = match[4];
    const fragments = [];
    const textRegex = /<text top="(\d+)" left="(\d+)" width="(\d+)" height="(\d+)" font="\d+">([\s\S]*?)<\/text>/gu;

    for (const textMatch of body.matchAll(textRegex)) {
      const top = Number(textMatch[1]);
      const left = Number(textMatch[2]);
      const fragmentWidth = Number(textMatch[3]);
      const fragmentHeight = Number(textMatch[4]);
      const raw = decodeHtml(stripTags(textMatch[5]));
      if (!raw.trim()) {
        continue;
      }

      fragments.push({
        top,
        left,
        width: fragmentWidth,
        height: fragmentHeight,
        raw,
      });
    }

    fragments.sort((a, b) => (a.top - b.top) || (a.left - b.left));
    const lines = [];
    let currentLine = null;

    for (const fragment of fragments) {
      if (!currentLine || Math.abs(currentLine.top - fragment.top) > 1) {
        currentLine = {
          pageNumber,
          top: fragment.top,
          height: fragment.height,
          parts: [fragment],
        };
        lines.push(currentLine);
        continue;
      }

      currentLine.parts.push(fragment);
      currentLine.height = Math.max(currentLine.height, fragment.height);
    }

    for (const line of lines) {
      line.parts.sort((a, b) => a.left - b.left);
      let text = '';
      let previousRight = null;
      for (const part of line.parts) {
        if (previousRight !== null && part.left - previousRight > 2 && !text.endsWith(' ')) {
          text += ' ';
        }
        text += part.raw;
        previousRight = part.left + part.width;
      }
      line.text = normalizeText(text);
      line.bottom = line.top + line.height;
    }

    pages.push({
      pageNumber,
      width,
      height,
      lines,
    });
  }

  return pages.sort((a, b) => a.pageNumber - b.pageNumber);
}

function parseAllHighlights(pages) {
  const byPage = new Map();

  for (const page of pages) {
    const svgPath = path.join(SVG_DIR, `page-${page.pageNumber}.svg`);
    const svgText = fs.readFileSync(svgPath, 'utf8');
    const svgHeightMatch = svgText.match(/<svg[^>]*height="([\d.]+)"/u);
    if (!svgHeightMatch) {
      throw new Error(`Missing svg height on page ${page.pageNumber}`);
    }

    const svgHeight = Number(svgHeightMatch[1]);
    const scaleY = page.height / svgHeight;
    const rects = [];
    const rectRegex = /<path[^>]*fill="rgb\(100%, 100%, 0%\)"[^>]*d="([^"]+)"/gu;

    for (const rectMatch of svgText.matchAll(rectRegex)) {
      const values = [...rectMatch[1].matchAll(/-?\d+(?:\.\d+)?/gu)].map((item) => Number(item[0]));
      if (values.length < 8) {
        continue;
      }

      const ys = [];
      for (let index = 1; index < values.length; index += 2) {
        ys.push(values[index]);
      }

      const top = Math.min(...ys) * scaleY;
      const bottom = Math.max(...ys) * scaleY;
      rects.push({ top, bottom });
    }

    byPage.set(page.pageNumber, rects);
  }

  return byPage;
}

function buildQuestions(pages, highlightMap) {
  const questions = [];
  let currentSection = 'BÀI NHẬP MÔN';
  let currentQuestion = null;
  let currentOption = null;
  let sequence = 0;

  const finalizeQuestion = () => {
    if (!currentQuestion) {
      return;
    }

    const prompt = normalizeText(currentQuestion.promptParts.join(' '));
    const options = currentQuestion.options.map((option) => ({
      id: option.id,
      text: normalizeText(option.textParts.join(' ')),
      highlighted: option.highlighted,
    }));
    const highlightedOptionIds = options.filter((option) => option.highlighted).map((option) => option.id);

    questions.push({
      id: `Q${String(sequence).padStart(3, '0')}`,
      order: sequence,
      section: currentQuestion.section,
      localNumber: currentQuestion.localNumber,
      prompt,
      options: options.map((option) => ({ id: option.id, text: option.text })),
      correctOptionId: highlightedOptionIds.length === 1 ? highlightedOptionIds[0] : null,
      highlightedOptionIds,
      pageStart: currentQuestion.pageStart,
    });

    currentQuestion = null;
    currentOption = null;
  };

  for (const page of pages) {
    const highlightRects = highlightMap.get(page.pageNumber) ?? [];

    for (const rawLine of page.lines) {
      const line = {
        ...rawLine,
        highlighted: isLineHighlighted(rawLine, highlightRects),
      };

      const segments = splitLineSegments(line.text);
      for (const text of segments) {
        if (!text) {
          continue;
        }

        if (/^BÀI NHẬP MÔN$/u.test(text)) {
          currentSection = 'BÀI NHẬP MÔN';
          continue;
        }

        if (/^BÀI\s+\d+$/u.test(text)) {
          currentSection = text;
          continue;
        }

        const questionMatch = text.match(/^(Câu|Cầu)\s+(\d+)[\.:]?\s*(.*)$/u);
        if (questionMatch) {
          finalizeQuestion();
          sequence += 1;
          currentQuestion = {
            section: currentSection,
            localNumber: Number(questionMatch[2]),
            promptParts: [questionMatch[3]],
            options: [],
            pageStart: line.pageNumber,
          };
          currentOption = null;
          continue;
        }

        const optionMatch = text.match(/^([ABCD])\.\s*(.*)$/u);
        if (optionMatch && currentQuestion) {
          currentOption = {
            id: optionMatch[1],
            textParts: [optionMatch[2]],
            highlighted: line.highlighted,
          };
          currentQuestion.options.push(currentOption);
          continue;
        }

        if (currentOption) {
          currentOption.textParts.push(text);
          currentOption.highlighted = currentOption.highlighted || line.highlighted;
          continue;
        }

        if (currentQuestion) {
          currentQuestion.promptParts.push(text);
        }
      }
    }
  }

  finalizeQuestion();
  return questions;
}

function buildExamSets(questions) {
  const ids = questions.map((question) => question.id);
  const sizes = Array.from({ length: 24 }, (_, index) => ({
    id: `DE-${String(index + 1).padStart(2, '0')}`,
    size: 30,
  }));
  sizes.push({ id: 'DE-25', size: 20 });

  const sets = sizes.map((set) => ({
    id: set.id,
    size: set.size,
    questionIds: [],
    seen: new Set(),
  }));

  const passTargets = sets.map((set) => set.size / 2);
  distributePass(shuffle(ids, 101), sets, passTargets.map((value) => value));
  distributePass(shuffle(ids, 202), sets, passTargets.map((value) => value));

  for (let index = 0; index < sets.length; index += 1) {
    sets[index].questionIds = shuffle(sets[index].questionIds, 900 + index);
    delete sets[index].seen;
  }

  return sets;
}

function distributePass(ids, sets, remainingTargets) {
  let pointer = 0;

  for (const id of ids) {
    let assigned = false;

    for (let attempt = 0; attempt < sets.length; attempt += 1) {
      const setIndex = (pointer + attempt) % sets.length;
      const set = sets[setIndex];
      if (remainingTargets[setIndex] <= 0) {
        continue;
      }
      if (set.seen.has(id)) {
        continue;
      }

      set.questionIds.push(id);
      set.seen.add(id);
      remainingTargets[setIndex] -= 1;
      pointer = (setIndex + 1) % sets.length;
      assigned = true;
      break;
    }

    if (!assigned) {
      throw new Error(`Failed to place question ${id} during set distribution`);
    }
  }
}

function buildReport(questions, examSets) {
  const usage = new Map(questions.map((question) => [question.id, 0]));
  for (const examSet of examSets) {
    for (const questionId of examSet.questionIds) {
      usage.set(questionId, (usage.get(questionId) ?? 0) + 1);
    }
  }

  return {
    questionCount: questions.length,
    setSizes: examSets.map((set) => ({ id: set.id, size: set.questionIds.length })),
    questionsMissingAnswers: questions
      .filter((question) => !question.correctOptionId)
      .map((question) => ({ id: question.id, section: question.section, localNumber: question.localNumber })),
    questionsWithMultipleAnswers: questions
      .filter((question) => question.highlightedOptionIds.length > 1)
      .map((question) => ({
        id: question.id,
        section: question.section,
        localNumber: question.localNumber,
        highlightedOptionIds: question.highlightedOptionIds,
      })),
    optionCountIssues: questions
      .filter((question) => question.options.length !== 4)
      .map((question) => ({ id: question.id, section: question.section, localNumber: question.localNumber, optionCount: question.options.length })),
    usageIssues: [...usage.entries()]
      .filter(([, count]) => count !== 2)
      .map(([id, count]) => ({ id, count })),
  };
}

function isLineHighlighted(line, rects) {
  for (const rect of rects) {
    const overlap = Math.min(line.bottom, rect.bottom) - Math.max(line.top, rect.top);
    if (overlap > Math.min(6, line.height * 0.25)) {
      return true;
    }
  }

  return false;
}

function shuffle(items, seed) {
  const result = [...items];
  const random = mulberry32(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let temp = value;
    temp = Math.imul(temp ^ (temp >>> 15), temp | 1);
    temp ^= temp + Math.imul(temp ^ (temp >>> 7), temp | 61);
    return ((temp ^ (temp >>> 14)) >>> 0) / 4294967296;
  };
}

function stripTags(value) {
  return value.replace(/<[^>]+>/gu, '');
}

function decodeHtml(value) {
  return value
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&apos;/gu, "'");
}

function normalizeText(value) {
  return value
    .replace(/\u00a0/gu, ' ')
    .replace(/\bП\b/gu, 'II')
    .replace(/\s+/gu, ' ')
    .replace(/\s+([,.;:?!])/gu, '$1')
    .replace(/([\[({"'])\s+/gu, '$1')
    .replace(/\s+([\])}"'])/gu, '$1')
    .replace(/\s*-\s*/gu, '-')
    .trim();
}

function splitLineSegments(value) {
  const normalized = value
    .replace(/(^|\s)В\./gu, '$1B.')
    .replace(/(^|\s)А\./gu, '$1A.')
    .replace(/(^|\s)С\./gu, '$1C.')
    .replace(/(^|\s)Д\./gu, '$1D.')
    .replace(/\s+(?=(?:Câu|Cầu)\s+\d+[\.:]?)/gu, '\n')
    .replace(/\s+(?=[ABCD]\.)/gu, '\n');

  return normalized
    .split(/\n+/u)
    .map((segment) => normalizeText(segment))
    .filter(Boolean);
}

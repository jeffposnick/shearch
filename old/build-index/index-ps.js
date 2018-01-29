const mz = require('mz/fs');
const recursive = require('recursive-readdir');

const validator = require('html-validator');
const validatorIgnore = ['Warning: Section lacks heading. Consider using \
  “h2”-“h6” elements to add identifying headings to all sections.',
'Error: Element “head” is missing a required instance of \
  child element “title”.',
'Error: Start tag seen without seeing a doctype first. \
  Expected “<!DOCTYPE html>”.'];

const {JSDOM} = require('jsdom');

const abbreviations = require('../config/filename-to-abbreviation.json');
const titles = require('../config/abbreviated-filename-to-title.json');

const bottom = mz.readFileSync('./html-fragments/bottom.html');
const top = mz.readFileSync('./html-fragments/top.html');

const DO_VALIDATION = true;
const IS_STANDALONE = false;
const OUTPUT_DIR = '../client/html/';
const PLAY_DIR = 'plays-bosak';
const POEM_DIR = 'poems-ps';
const TEXTS_DIR = '../texts/';

const stageDirRegEx = /<STAGEDIR>([^<]+)<\/STAGEDIR>/gi;

// Some opening tags in poem sections have attributes to remove, some don't.
const coupletOpenRegex = /<couplet>/gi;
const coupletCloseRegex = /<\/couplet>/gi;
const finisRegex = /<finis>\n*.*\n*.*<\/finis>/gim; // only one of these...
const foreignRegex = /<foreign[^>]+([^<]+)<\/foreign>/gi;
const lineOpenRegex = /<line [^>]+>/gi;
const lineCloseRegex = /<\/line>/gi;
const quatrainOpenRegex = /<quatrain[^>]*>/gi; // some quatrains have atrributes
const quatrainCloseRegex = /<\/quatrain>/gi;
const stanzaOpenRegex = /<stanza [^>]+>/gi; // NB space: avoid stanzasmall match
const stanzaCloseRegex = /<\/stanza>/gi;
const stanzanumOpenRegex = /<stanzanum [^>]+>/gi;
const stanzanumCloseRegex = /<\/stanzanum>/gi;
const stanzasmallOpenRegex = /<stanzasmall>/gi;
const stanzasmallCloseRegex = /<\/stanzasmall>/gi;
const subtitleOpenRegex = /<subtitle>/gi;
const subtitleCloseRegex = /<\/subtitle>/gi;
const tercetOpenRegex = /<tercet>/gi;
const tercetCloseRegex = /<\/tercet>/gi;

let numFilesToProcess = 0;

// Parse each file in the directory of texts
recursive(TEXTS_DIR).then(filepaths => {
  filepaths = filepaths.filter(filename => {
    return filename.match(/.+xml/); // filter out .DS_Store, etc.
  });
  numFilesToProcess = filepaths.length;
  for (const filepath of filepaths) {
    parseText(filepath);
  }
}).catch(error => console.error(`Error reading from ${TEXTS_DIR}:`, error));

function parseText(filepath) {
  console.time('Parse texts');
  JSDOM.fromFile(filepath, {contentType: 'text/xml'})
    .then(dom => {
      const filename = filepath.split('/').pop();
      const document = dom.window.document;
      if (filepath.includes(PLAY_DIR)) {
        console.log('filename', filename);
        parsePlay(filename, document);
      } else if (filepath.includes(POEM_DIR)) {
        parsePoem(filename, document);
      } else {
        console.error(`Unexpected filepath ${filepath}`);
        return;
      }
      console.log(`${numFilesToProcess} files to process`);
      if (--numFilesToProcess === 0) {
        console.timeEnd('Parse texts');
      }
    }).catch(error => {
      console.log(`Error creating DOM from ${filepath}`, error);
    });
}

// **************
// Play functions

function parsePlay(filename, document) {
  // change filename to match standard MLA Shakespeare abbreviation
  if (abbreviations[filename]) {
    filename = abbreviations[filename] + '.html';
  } else {
    console.error(`Filename ${filename} not found in ${abbreviations}`);
  }
  const title = titles[filename];
  if (!title) {
    console.error(`Title not found for ${filename}`);
  }
  // preamble is play title, personae, etc.
  let html = addPreamble(document) + addActs(document);
  // for standalone html document, add <head> and other elements
  // top and bottom are buffers, ${title} a placeholder for the title
  if (IS_STANDALONE) {
    html = ('' + top).replace('${title}', title) + html + bottom;
  }
  // html = minify(html);
  writeFile(filename, html);
}

function addPreamble(document) {
  let html = '<section id="preamble">\n\n';
  const title = document.getElementsByTagName('TITLE')[0].textContent;
  html += `<h1 id="title">${title}</h1>\n\n`;
  html += addPersonae(document);
  const scndescr = document.getElementsByTagName('SCNDESCR')[0].textContent;
  html += `<div id="scene-description">${scndescr}</div>\n\n`;
  html += '</section>\n\n';
  return html;
}

function addPersonae(document) {
  let html = '<section id="dramatis-personae">';
  html += '<h2>Dramatis Personae</h2>\n\n';
  const children = document.getElementsByTagName('PERSONAE')[0].children;
  for (const child of children) {
    switch (child.nodeName) {
    case 'PGROUP': {
      const grpdescr = child.getElementsByTagName('GRPDESCR')[0].textContent;
      html += `<ol class="persona-group" data-description="${grpdescr}">\n`;
      const personas = child.getElementsByTagName('PERSONA');
      for (const persona of personas) {
        html += '  <li>' + persona.textContent.trim() + '</li>\n';
      }
      html += '</ol>\n\n';
      break;
    }
    case 'PERSONA': // Some PERSONA elements are not in PGROUP elements :/
      if (child.previousElementSibling.nodeName !== 'PERSONA') {
        html += '<ol class="persona-group">\n';
      }
      html += `  <li>${child.textContent}</li>\n`;
      // this persona element may be the last sibling
      if (!child.nextElementSibling ||
        child.nextElementSibling.nodeName !== 'PERSONA') {
        html += '</ol>\n\n';
      }
      break;
    case 'TITLE':
      break;
    default:
      console.error(`${play(child)}: unexpected child ${child.nodeName}`);
    }
  }
  html += '</section>\n\n';
  return html;
}

function addActs(document) {
  let html = '';
  const acts = document.getElementsByTagName('ACT');
  for (const act of acts) {
    html += '<section class="act">\n\n';
    const title = act.getElementsByTagName('TITLE')[0].textContent;
    html += `<h2>${title}</h2>\n\n`;
    const scenes = act.getElementsByTagName('SCENE');
    for (const scene of scenes) {
      html += addScene(scene);
    }
    html += '</section>\n\n';
  }
  return fix(html);
}

function addScene(scene) {
  addLineNumberMarkup(scene); // temporary hack: not possible in pure CSS :(
  let html = '<section class="scene">\n\n';
  const children = scene.children;
  for (const child of children) {
    switch(child.nodeName) {
    case 'speech':
      html += addSpeech(child);
      break;
    case 'stagedir':
      html += `<div class="stage-direction">${child.textContent}</div>\n\n`;
      break;
    case 'scenetitle':
      html += `<h3>${child.textContent}</h3>\n\n`;
      break;
    case 'scenelocation':
      html += `<h4 class="scene-location">${child.textContent}</h4>\n\n`;
      break;
    default:
      console.error(`${play(scene)}: weird scene element ${child.nodeName}`);
    }
  }
  html += '</section>\n\n';
  return html;
}

function addSpeech(speech) {
  const children = speech.children;
  let html = '';
  let number;
  let speakers = [];
  for (const child of children) {
    switch(child.nodeName) {
    case 'line':
      // addLineNumberMarkup() adds number attribute to every fifth line element
      number = child.hasAttribute('number') ? ' class="number"' : '';
      // stage directions are sometimes inline
      var line = child.innerHTML.
        replace(stageDirRegEx, '<span class="stage-direction">$1</span>');
      html += `  <li${number}>${line}</li>\n`;
      break;
    case 'speaker':
      // speeches occasionally have more than one speaker
      speakers.push(child.textContent);
      break;
    case 'stagedir':
      html += `  <li class="stage-direction">${child.textContent}</li>\n`;
      break;
    default:
      console.error(`${play(speech)}: weird speech element ${child.nodeName}`);
    }
  }
  return `<ol data-speaker="${speakers.join(', ')}">\n` + html + '</ol>\n\n';
}

// **************
// Poem functions

function parsePoem(filename, document) {
  const poemAbbreviation = abbreviations[filename];
  if (poemAbbreviation === 'Son') {
    // sonnet file includes multiple poems
    addSonnets(document);
  } else {
    addSinglePoem(document, poemAbbreviation);
  }
}

function addSonnets(document) {
  let html = '<h1 id="title">Sonnets</h1>\n\n';
  const sonnets = document.getElementsByTagName('sonnet');
  for (let i = 0; i !== sonnets.length; ++i) {
    const sonnet = sonnets[i];
    html += '<section class="poem">\n';
    html += `  <h2>Sonnet ${roman(i + 1)}</h2>\n`;
    html += '  <ol>\n';
    const lines = sonnet.getElementsByTagName('line');
    for (let j = 0; j !== lines.length; ++j) {
      // add class="number" if this line should be numbered
      const isNumbered = (j + 1) % 5 === 0 && j !== 0;
      const number = isNumbered ? ' class="number"' : '';
      html += `    <li${number}>${lines[j].textContent}</li>\n`;
    }
    html += '</ol>\n';
    html += '</section>\n\n';
  }
  if (IS_STANDALONE) {
  // top and bottom are buffers, ${title} a placeholder for the title
    html = ('' + top).replace('${title}', 'Sonnets') + fix(html) + bottom;
  }
  // html = minify(html);
  writeFile('Son.html', html);
}

function addSinglePoem(document, poemAbbreviation) {
  const title = document.getElementsByTagName('title')[0].textContent;
  let html = `<h1 id="title">${title}</h1>\n\n`;
  const poemintro = document.getElementsByTagName('poemintro')[0];
  if (poemintro) {
    const poemintroText = poemintro.textContent.trim().
      replace(/(\n\s+){3,}/gm, '\n\n    ').replace(/\n/g, '<br>');
    html += `<section id="poemintro">\n${poemintroText}\n</section>\n`;
  }
  html += getPoemBody(document);
  if (IS_STANDALONE) {
    // top and bottom are buffers, ${title} a placeholder for the title
    html = ('' + top).replace('${title}', title) + html + bottom;
  }
  // html = minify(html);
  writeFile(`${poemAbbreviation}.html`, html);
}

function getPoemBody(document) {
  const poembody = document.getElementsByTagName('poembody')[0].innerHTML;
  return poembody.
    replace(coupletOpenRegex, '<section class="couplet">').
    replace(coupletCloseRegex, '</section>').
    replace('<dedication>', '<section id="dedication">').
    replace('</dedication>', '</section>').
    replace(finisRegex, '<h2 id="finis">FINIS.</h2>').
    replace(foreignRegex, '$1').
    replace(lineOpenRegex, '  <p>').
    replace(lineCloseRegex, '</p>').
    replace(quatrainOpenRegex, '<section class="quatrain">').
    replace(quatrainCloseRegex, '</section>').
    replace(stanzaOpenRegex, '<section class="stanza">').
    replace(stanzaCloseRegex, '</section>').
    replace(stanzanumOpenRegex, '<h2 class="stanzanum">').
    replace(stanzanumCloseRegex, '</h2>').
    replace(stanzasmallOpenRegex, '<section class="stanzasmall">').
    replace(stanzasmallCloseRegex, '</section>').
    replace(subtitleOpenRegex, '<h2 class="subtitle">').
    replace(subtitleCloseRegex, '</h2>\n').
    replace(tercetOpenRegex, '<section class="tercet">').
    replace(tercetCloseRegex, '</section>');
}

// *****************
// Utility functions

// Add number attribute to every fifth line, so line number is displayed
// TODO: code to cope with lines that span two displayed lines :^/
function addLineNumberMarkup(scene) {
  const lines = scene.getElementsByTagName('LINE');
  for (let i = 0; i !== lines.length; ++i) {
    let line = lines[i];
    if ((i + 1) % 5 === 0 && i !== 0) {
      line.setAttribute('number', true);
    }
  }
}

function fix(html) {
  return html.
    replace('&c', 'etc.').
    replace(/,--/g, ' — ').
    replace(/--/g, ' — ').
    replace(/, —/g, ' — ').
    replace(/'/g, '’');
  // replace(/&#8217;/g, '’')
}

function writeFile(filename, html) {
  if (DO_VALIDATION) {
    validate(filename, html);
  }
  console.log(`Writing file ${filename}`);
  mz.writeFile(OUTPUT_DIR + filename, html).
    catch(error => console.error(`Error writing ${filename}:`, error));
}

// Check that a file contains valid HTML
function validate(filename, html) {
  const options = {
    data: html,
    format: 'text',
    ignore: validatorIgnore/* ,
    validator: 'https://html5.validator.nu' */
  };
  validator(options).then(data => {
    if (data.includes('Error')) {
      console.error(filename, data);
    }
  }).catch(error => {
    console.error(`Error validating ${filename}:`, error);
  });
}

function play(element) {
  return element.ownerDocument.getElementsByTagName('TITLE')[0].textContent;
}

function roman(integer) {
  const romanNumeral = integer;
  return romanNumeral;
}
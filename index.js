var cheerio = require('cheerio');
var fs = require('fs');
var slugFn = require('slug');
var _ = require('lodash');
var path = require('path');
var Q = require('q');

var excudeTags,
  labelPrefix,
  replaceSourceHTML,
  wrapHTMLinHtmlBody = true,
  isFullHtmlPage = true,
  totalStrings = 0;

function fileLoaded(fileName, _, data) {
  data = prepareHtml(wrapHTMLinHtmlBody ? wrapTemplateCode(data) : data);
  var $ = cheerio.load(data);
  var result = parse($);

  result.html = wrapHTMLinHtmlBody ? postprocessHtml(result.html).replace('<html><body>', '').replace('</body></html>', '') : postprocessHtml(result.html);

  writeAndFinalise(result, fileName);
}

const writeAndFinalise = (result, fileName) => {

  const htmlName = path.parse(fileName).name;

  const outputHtmlPath = replaceSourceHTML ? fileName : './' + htmlName + '_translation.html';
  const outputJsonPath = './' + htmlName + '_translation.json';

  let htmlWritePromise = Q.defer();
  let jsonWritePromise = Q.defer();

  fs.writeFile(outputHtmlPath, result.html, (err) => htmlWritePromise.resolve());
  fs.writeFile(outputJsonPath, JSON.stringify(result.json, null, 2), (err) => jsonWritePromise.resolve());

  Q.allSettled([htmlWritePromise, jsonWritePromise])
    .then(results => {
      console.log('Done! Total string processed: ', totalStrings);
    })
}

function prepareHtml(html) {
  function prepareEjs() {
    html = html.replace(/<%([\w\W]*?)%>/g, function (match, subMatch) {
      return "<!-- <%" + subMatch + "%> -->";
    });
  }
  prepareEjs();
  return html;
}

function postprocessHtml(html) {
  function postprocessEjs() {
    html = html.replace(/<!-- <%([\w\W]*?)%> -->/g, function (match, subMatch) {
      return "<%" + subMatch + "%>";
    });

    // Restoring ejs tags that were part of HTML tags attribute
    html = html.replace(/&lt;!-- &lt;%([\w\W]*?)%&gt; --&gt;/g, function (match, subMatch) {
      return "<%" + subMatch + "%>";
    });
    html = html.replace(/&apos;/g, function (match, subMatch) {
      return "'";
    }); // CAUTION: will replace &apos; even if it was put into HTML intentionally
  }
  postprocessEjs();
  return html;
}

function getNodeTextAndHtml(node) {
  var text = node
    .clone()
    .children()
    .remove()
    .end()
    .text();

  var html = node.html();

  return {
    text,
    html
  };
}

function getSlug(text) {
  var separator = /({{.*?}})/gi;
  var splits = text.split(separator);

  var strings = [];

  _.each(splits, function (s) {
    if (s.indexOf('{{') === 0) {
      return;
    }
    strings.push(s);
  });

  return slugFn(strings.join(' '), {
    replacement: '_',
    symbols: true,
    lower: true
  });
}

function getBindings(text) {
  var separator = /({{.*?}})/gi;
  var splits = text.split(separator);
  var bindings = [];

  _.each(splits, function (s) {
    if (s.indexOf('{{') === 0) {
      bindings.push(s);
    }
  });

  return bindings;
}

function processElement(i, $elem) {
  var result = {};

  var textAndHtml = getNodeTextAndHtml($elem);
  var childrenCount = $elem.children().length;

  var slug = getSlug(textAndHtml.text);

  if (slug.length === 0) {
    // No slug - no need to translate text in node
    return;
  }

  if (!isNaN(parseFloat(slug))) {
    // is Number
    return;
  }

  totalStrings++;

  var translatedText;

  if (childrenCount > 0) {
    translatedText = textAndHtml.html;
  } else {
    translatedText = textAndHtml.text;
  }

  $elem.attr('translate', getPrefixedSlug(slug));

  $elem.html('');

  var bindings = getBindings(translatedText);
  if (bindings.length > 0) {
    $elem.attr('translate-values', 'REPLACE_' + i + ' ' + bindings.join('::'));
    translatedText = 'REPLACE_' + i + ' ' + translatedText;
  }
  result[getPrefixedSlug(slug)] = clearTranslatedText(translatedText);

  return result;
}

const clearTranslatedText = (text) => text.replace('\r\n', '').trim();

function parse($) {
  var result = {};
  var counter = 0;

  const getElemTagAndClassSelector = (excudeTags, elem) => {
    if (excudeTags.indexOf('.') > -1 && elem.attribs.class) {
      return elem.attribs.class.indexOf(excudeTags.split('.')[1]) > -1;
    }
  }

  function process(elements) {
    elements.each(function (i, elem) {
      var $elem = $(elem);

      // exclude TAG.CLASS elements
      if ($elem[0].name === excudeTags && getElemTagAndClassSelector(excudeTags, $elem[0])) {
        return;
      }

      var processedResult = processElement(counter++, $elem);
      result = _.merge(result, processedResult);

      if (!processedResult) {
        return process($elem.children());
      }
    });
  }

  process($('html > *'));

  return {
    html: $.html(),
    json: result
  };
}



const run = (fileName, labelPrefixInput, excudeTagsInput, replaceSourceHTMLInput) => {

  labelPrefix = labelPrefixInput || '';
  excudeTags = excudeTagsInput || '';
  replaceSourceHTML = replaceSourceHTMLInput || false;

  fs.readFile(fileName, 'utf8', fileLoaded.bind(null, fileName));

};

const wrapTemplateCode = (code) => `<html><body>${code}</body></html>`;

const getPrefixedSlug = (slug) => labelPrefix + '_' + slug;

run(process.argv[2], process.argv[3], process.argv[4], process.argv[5]);
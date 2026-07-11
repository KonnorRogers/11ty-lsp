import { CompletionItem, CompletionItemKind, InsertTextFormat } from "vscode-css-languageservice"

/**
 * https://mozilla.github.io/nunjucks/templating.html#tags
 */
export const tags: Record<string, CompletionItem> = {
  if: {
    label: "if",
    kind: CompletionItemKind.Snippet,
    documentation: "if tests a condition and lets you selectively display content. It behaves exactly as javascript's if behaves.",
    insertText: "{% if $1 %}\n  $2\n{% endif %}",
    insertTextFormat: InsertTextFormat.Snippet
  },
  for: {
    label: "for",
    documentation: "for iterates over arrays and dictionaries.",
    kind: CompletionItemKind.Snippet,
    insertText: "{% for $1 in $2 %}\n  $3\n{% endfor %}",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  asyncEach: {
    label: "asyncEach",
    documentation: "asyncEach is an asynchronous version of for. You only need this if you are using a custom template loader that is asynchronous; otherwise you will never need it",
    insertText: "{% asyncEach $1 in $2 %}\n  $3\n{% endeach %}",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  asyncAll: {
    label: "asyncAll",
    documentation: "asyncAll is similar to asyncEach, except it renders all the items in parallel, preserving the order of the items. This is only helpful if you are using asynchronous filters, extensions, or loaders. Otherwise you should never use this.",
    insertText: "{% asyncAll $1 in $2 %}\n  $3{% endall %}",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  macro: {
    label: "macro",
    documentation: "macro allows you to define reusable chunks of content. It is similar to a function in a programming language.",
    insertText: "{% macro $1 %}\n  $2\n{% endmacro %}",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  set: {
    label: "set",
    documentation: "set lets you create/modify a variable.",
    insertText: "{% set $1 = $2 %}",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  extends: {
    label: "extends",
    documentation: "extends is used to specify template inheritance. The specified template is used as a base template.",
    insertText: "{% extends $1 %}",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  block: {
    label: "block",
    documentation: "block defines a section on the template and identifies it with a name. This is used by template inheritance. Base templates can specify blocks and child templates can override them with new content",
    insertText: "{% block $1 %}\n  $2\n{% endblock %}",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  include: {
    label: "include",
    documentation: "include pulls in other templates in place. It's useful when you need to share smaller chunks across several templates that already inherit other templates.",
    insertText: "{% include $1 %}",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  import: {
    label: "import",
    documentation: `import loads a different template and allows you to access its exported values. Macros and top-level assignments (done with set) are exported from templates, allowing you to access them in a different template.

Imported templates are processed without the current context by default, so they do not have access to any of the current template variables.`,
    insertText: "import $1 as $2",
    insertTextFormat: InsertTextFormat.Snippet
  },
  raw: {
    label: "raw",
    documentation: "If you want to output any of the special Nunjucks tags like {{, you can use a {{, you can use a {% raw %} block and anything inside of it will be output as plain text.",
    insertText: "{% raw %}\n  $2\n{% endraw %}",
    insertTextFormat: InsertTextFormat.Snippet
  },
  verbatim: {
    label: "verbatim",
    documentation: "{% verbatim %} has identical behavior as {% raw %}. It is added for compatibility with the Twig verbatim tag.",
    insertText: "{% verbatim %}\n  $1\n{% endverbatim %}",
    insertTextFormat: InsertTextFormat.Snippet
  },
  filter: {
    label: "filter",
    documentation: "A filter block allows you to call a filter with the contents of the block. Instead passing a value with the | syntax, the render contents from the block will be passed.",
    insertText: "{% filter $1 %}\n  $2\n{% endfilter %}",
    insertTextFormat: InsertTextFormat.Snippet
  },
  call: {
    label: "call",
    documentation: "A call block enables you to call a macro with all the text inside the tag. This is helpful if you want to pass a lot of content into a macro. The content is available inside the macro as caller().",
    insertText: "{% call $1 %}\n  $2\n{% endcall %}",
    insertTextFormat: InsertTextFormat.Snippet,
  }
}

export const globalFunctions: Record<string, CompletionItem> = {
  range: {
    label: "range",
    documentation: "If you need to iterate over a fixed set of numbers, range generates the set for you. The numbers begin at start (default 0) and increment by step (default 1) until it reaches stop, not including it.",
    insertText: "range($1)",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  cycler: {
    label: "cycler",
    documentation: "An easy way to rotate through several values is to use cycler, which takes any number of arguments and cycles through them.",
    insertText: "cycler($1)",
    insertTextFormat: InsertTextFormat.Snippet,
  },
  joiner: {
    label: "joiner",
    documentation: `When combining multiple items, it's common to want to delimit them with something like a comma, but you don't want to output the separator for the first item. The joiner class will output separator (default ",") whenever it is called except for the first time.`,
    insertText: "joiner($1)",
    insertTextFormat: InsertTextFormat.Snippet,
  }
}

export const filters: Record<string, CompletionItem> = {
  abs: {
    label: "abs",
    documentation: "Return the absolute value of the argument",
    insertText: "abs",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  batch: {
    label: "batch",
    documentation: "Return a list of lists with the given number of items",
    insertText: "batch",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  capitalize: {
    label: "capitalize",
    documentation: "Make the first letter uppercase, the rest lower case",
    insertText: "capitalize",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  center: {
    label: "center",
    documentation: "Center the value in a field of a given width",
    insertText: "center",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  default: {
    label: "default",
    documentation: `If value is strictly undefined, return default, otherwise value. If boolean is true, any JavaScript falsy value will return default (false, "", etc)`,
    insertText: "default",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  dictsort: {
    label: "dictsort",
    documentation: "Sort a dict and yield (key, value) pairs",
    insertText: "dicsort",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  dump: {
    label: "dump",
    documentation: "Call JSON.stringify on an object and dump the result into the template. Useful for debugging: {{ items | dump }}",
    insertText: "dump",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  escape: {
    label: "escape",
    documentation: "Convert the characters &, <, >, ‘, and ” in strings to HTML-safe sequences. Use this if you need to display text that might contain such characters in HTML. Marks return value as markup string",
    insertText: "escape",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  first: {
    label: "first",
    documentation: "Get the first item in an array or the first letter if it's a string",
    insertText: "first",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  float: {
    label: "float",
    documentation: "Convert a value into a floating point number. If the conversion fails 0.0 is returned. This default can be overridden by using the first parameter.",
    insertText: "float",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  forceescape: {
    label: "forceescape",
    documentation: "Enforce HTML escaping. This will probably double escape variables.",
    insertText: "forceescape",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  groupby: {
    label: "groupby",
    documentation: "Group a sequence of objects by a common attribute:",
    insertText: "groupby",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  int: {
    label: "int",
    documentation: "Convert the value into an integer. If the conversion fails 0 is returned.",
    insertText: "int",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  join: {
    label: "join",
    documentation: "Return a string which is the concatenation of the strings in a sequence",
    insertText: "join",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  last: {
    label: "last",
    documentation: "Get the last item in an array or the last letter if it's a string",
    insertText: "last",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  length: {
    label: "length",
    documentation: "Return the length of an array or string, or the number of keys in an object",
    insertText: "length",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  list: {
    label: "list",
    documentation: "Convert the value into a list. If it was a string the returned list will be a list of characters",
    insertText: "list",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  lower: {
    label: "lower",
    documentation: "Convert string to all lower case",
    insertText: "lower",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  random: {
    label: "random",
    documentation: "Select a random value from an array. (This will change everytime the page is refreshed).",
    insertText: "random",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  reject: {
    label: "reject",
    documentation: "Filters a sequence of objects by applying a test to each object, and rejecting the objects with the test succeeding.",
    insertText: "reject",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  rejectattr: {
    label: "rejectattr",
    documentation: "Filter a sequence of objects by applying a test to the specified attribute of each object, and rejecting the objects with the test succeeding.",
    insertText: "rejectattr",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  replace: {
    label: "replace",
    documentation: "Replace one item with another. The first item is the item to be replaced, the second item is the replaced value.",
    insertText: "replace",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  reverse: {
    label: "reverse",
    documentation: "Reverse a string or array",
    insertText: "reverse",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  round: {
    label: "round",
    documentation: "Round a number",
    insertText: "round",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  safe: {
    label: "safe",
    documentation: "Mark the value as safe which means that in an environment with automatic escaping enabled this variable will not be escaped.",
    insertText: "safe",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  select: {
    label: "select",
    documentation: "Filters a sequence of objects by applying a test to each object, and only selecting the objects with the test succeeding.",
    insertText: "select",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  selectattr: {
    label: "selectattr",
    documentation: "Filter a sequence of objects by applying a test to the specified attribute of each object, and only selecting the objects with the test succeeding.",
    insertText: "selectattr",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  slice: {
    label: "slice",
    documentation: "Slice an iterator and return a list of lists containing those items",
    insertText: "slice",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  sort: {
    label: "sort",
    documentation: "Sort arr with JavaScript's arr.sort function. If reverse is true, result will be reversed. Sort is case-insensitive by default, but setting caseSens to true makes it case-sensitive. If attr is passed, will compare attr from each item.",
    insertText: "sort",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  striptags: {
    label: "striptags",
    documentation: "Analog of jinja's striptags. If preserve_linebreaks is false (default), strips SGML/XML tags and replaces adjacent whitespace with one space. If preserve_linebreaks is true, normalizes whitespace, trying to preserve original linebreaks. Use second behavior if you want to pipe {{ text | striptags(true) | escape | nl2br }}. Use default one otherwise.",
    insertText: "striptags",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  sum: {
    label: "sum",
    documentation: "Output the sum of items in the array",
    insertText: "sum",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  title: {
    label: "title",
    documentation: "Make the first letter of the string uppercase",
    insertText: "title",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  trim: {
    label: "trim",
    documentation: "Strip leading and trailing whitespace",
    insertText: "trim",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  truncate: {
    label: "truncate",
    documentation: `Return a truncated copy of the string. The length is specified with the first parameter which defaults to 255. If the second parameter is true the filter will cut the text at length. Otherwise it will discard the last word. If the text was in fact truncated it will append an ellipsis sign ("..."). A different ellipsis sign than "(...)" can be specified using the third parameter.`,
    insertText: "truncate",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  upper: {
    label: "upper",
    documentation: "Convert the string to upper case",
    insertText: "upper",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  urlencode: {
    label: "urlencode",
    documentation: "Escape strings for use in URLs, using UTF-8 encoding. Accepts both dictionaries and regular strings as well as pairwise iterables.",
    insertText: "urlencode",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  urlize: {
    label: "urlize",
    documentation: "Convert URLs in plain text into clickable links",
    insertText: "urlize",
    insertTextFormat: InsertTextFormat.PlainText,
  },
  wordcount: {
    label: "wordcount",
    documentation: "Count and output the number of words in a string",
    insertText: "wordcount",
    insertTextFormat: InsertTextFormat.PlainText,
  },
}

export const generalCompletions = {
  variable: {
    label: '{{ }}',
    kind: CompletionItemKind.Snippet,
    documentation: 'Variable',
    insertText: '{{ $1 }}',
    insertTextFormat: InsertTextFormat.Snippet
  },
  expression: {
    label: '{% %}',
    kind: CompletionItemKind.Snippet,
    documentation: 'Expression',
    insertText: '{% $1 %}',
    insertTextFormat: InsertTextFormat.Snippet
  },
  comment: {
    label: '{# #}',
    kind: CompletionItemKind.Snippet,
    documentation: 'Comment',
    insertText: '{# $1 #}',
    insertTextFormat: InsertTextFormat.Snippet
  }
}

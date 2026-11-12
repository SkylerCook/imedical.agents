'use strict';

// Web document slashes are routing separators, not characters within one segment.
function encodeDocumentPath(name) {
  return name.split('/').map(segment => encodeURIComponent(segment)).join('/');
}
function documentReadPath(name, {binary = false} = {}) {
  return 'doc/' + encodeDocumentPath(name) + (binary ? '?binary=1' : '');
}
module.exports = {encodeDocumentPath, documentReadPath};

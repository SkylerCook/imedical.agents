'use strict';

// Web document slashes are routing separators, not characters within one segment.
function encodeDocumentPath(name) {
  return name.split('/').map(segment => encodeURIComponent(segment)).join('/');
}
module.exports = {encodeDocumentPath};

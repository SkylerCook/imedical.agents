'use strict';

function data(field, piece) {
  return '<Data name="' + field + '">\n<Delimiter>"^"</Delimiter>\n<Piece>' + piece + '</Piece>\n</Data>\n';
}

function sqlStorageFixture() {
  const mapping = data('New_Value', 6);
  const property = 'Property NewValue As %String(MAXLEN = 50) [ SqlFieldName = "New_Value" ];\n';
  const baseline = [
    'Class Demo Extends %Persistent [ Owner = {_SYSTEM}, StorageStrategy = SQLStorage ]',
    '{',
    'Property CurrentValue As %String [ SqlFieldName = Current_Value ];',
    'Property EarlierValue As %String;',
    'Storage SQLStorage',
    '{',
    '<SQLMap name="Index"><Global>^Demo</Global><Type>index</Type></SQLMap>',
    '<SQLMap name="Rows">',
    data('Current_Value', 5).trimEnd(),
    data('EarlierValue', 1).trimEnd(),
    '<Global>^Demo</Global>',
    '<Structure>delimited</Structure>',
    '<Type>data</Type>',
    '</SQLMap>',
    '<Type>%Storage.SQL</Type>',
    '}',
    '}',
    ''
  ].join('\n');
  const candidate = baseline
    .replace('Storage SQLStorage', property + '\nStorage SQLStorage')
    .replace('<Structure>delimited', mapping + '<Structure>delimited');
  return {baseline, candidate, property, mapping};
}

module.exports = {data, sqlStorageFixture};

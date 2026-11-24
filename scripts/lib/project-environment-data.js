'use strict';

const {isDeepStrictEqual} = require('node:util');

const credentialFile = 'iris-profile-credentials.json';
const sections = {
  iris:['scheme','host','port','namespace','tlsVerify','alias','description','pathPrefix','webBasePath'],
  web:['basePath','cspBasePath','brokerPath','frontendTransport'],
  mcp:['serverName','serverPath','nodeTlsRejectUnauthorized','includeBuiltInSkills'],
  sftp:['enabled','runtime','serverName','command','args','scriptPath','keyFile','knownHosts',
    'allowRemoteCommands','host','port','localPath','remotePath','ignorePatterns'],
};
const privateKeys = {iris:['username','password'],web:['cookie'],sftp:['username','password']};

function object(value, section) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid-project-environment: ' + section);
  return value;
}

function credential(values, ref, section) {
  const match = /^private:([\w$-]+)$/.exec(ref);
  if (!match || !Object.hasOwn(values,match[1])) return {};
  const entry = object(values[match[1]],'credential reference');
  if (Object.keys(entry).some(key=>!privateKeys[section].includes(key) || typeof entry[key] !== 'string')) {
    throw Error('invalid-project-environment: credential reference');
  }
  return entry;
}

function canonical(data) {
  return data.irisConnections?.source === 'project.jsonc' || Object.hasOwn(data,'serviceConnections') || Object.hasOwn(data,'mcp');
}

function projectEnvironment(data, values) {
  const config = {};
  const state = data.irisConnections;
  if (state?.source === 'project.jsonc') {
    const profile = state.profiles?.[state.active];
    if (!profile || !Object.hasOwn(state.profiles,state.active)) throw Error('invalid-project-environment: active profile');
    const {credentialRef,...iris} = profile;
    const pair = credential(values,credentialRef,'iris');
    config.iris = {...iris,...pair};
    config.irisProfileCredentials = values;
  }
  if (data.mcp) config.mcp = object(data.mcp,'mcp');
  for (const section of ['web','sftp']) {
    if (data.serviceConnections?.[section] === undefined) continue;
    const {credentialRef,...connection} = object(data.serviceConnections[section],section);
    config[section] = {...connection,...credential(values,credentialRef,section)};
  }
  return config;
}

function verifyLegacy(config, legacy) {
  for (const [section,entry] of Object.entries(legacy)) {
    for (const [key,value] of Object.entries(object(entry,section))) {
      if (!isDeepStrictEqual(config[section]?.[key],value)) {
        // Profile ports and TLS were read as numbers and booleans by older tools.
        if (section === 'iris' && ['port','tlsVerify'].includes(key) &&
            String(config[section]?.[key]) === String(value)) continue;
        throw Error('project-config-conflict: project-env.json / ' + section + '.' + key);
      }
    }
  }
}

function read(data, legacy, values = {}) {
  if (!canonical(data)) return legacy;
  const result = projectEnvironment(data,values);
  if (legacy) verifyLegacy(result,legacy);
  return result;
}

module.exports = {canonical,read,sections,privateKeys,credentialFile};

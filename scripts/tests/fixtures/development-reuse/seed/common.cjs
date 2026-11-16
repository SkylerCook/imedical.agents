exports.renderCode = value => String(value).trim().toUpperCase();
exports.list = rows => rows.filter(row => row.active);
exports.remove = (rows, id, actor) => {
  if (!actor.admin) {
    throw new Error("forbidden");
  }
  return rows.filter(row => row.id !== id);
};

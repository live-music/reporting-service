const ENV = process.env;
const request = require('request');
const mongoose = require('mongoose');
const convert = require('mongoose_schema-json');

const { Schema } = mongoose;

const models = ['Set', 'Track'];

function fixMappings(type) {
  switch (type) {
    case 'Schema.Types.ObjectId':
      return mongoose.Schema.ObjectId;
    case 'Boolean':
      return Boolean;
    case 'Number':
      return Number;
    case 'String':
      return String;
    case 'Date':
      return Date;
    case 'Date.now':
      return Date.now;
    default:
      return type;
  }
}

function fixObjectId(schema) {
  for (var key in schema) { // eslint-disable-line
    if (schema.hasOwnProperty(key)) { // eslint-disable-line
      if (Array.isArray(schema[key])) {
        schema[key].forEach(found => {
          if (found.type) found.type = fixMappings(found.type);
          if (found.default) found.default = fixMappings(found.default);

          found = fixObjectId(found); // Recursive mapping fix
        });
      }

      if (schema[key].type) schema[key].type = fixMappings(schema[key].type);
      if (schema[key].default) schema[key].default = fixMappings(schema[key].default);

      if (schema[key].validate) {
        schema[key].validate = [
          (password) => {
            if (password && password.length >= 6) {
              return true;
            }
            return false;
          },
          'Password must be six characters or more'
        ];
      }
    }
  }

  return schema;
}

exports.initialize = () => {
  const promises = [];
  models.forEach(model => {
    promises.push(new Promise((resolve, reject) => {
      const url = `${ ENV.BASE_URL }/schema/${ model.toLowerCase() }`;
      request(url, (err, response, body) => {
        if (body) {
          try {
            const converted = JSON.parse(convert.json2schema(body));
            const patched = fixObjectId(converted);
            const schema = new Schema(patched);
            schema.set('toJSON', {
              getters:  true,
              virtuals: true
            });
            mongoose.model(model, schema);
            resolve(model);
          } catch (error) {
            reject(error);
          }
        } else if (err) {
          reject(err);
        }
      });
    }));
  });

  return Promise.all(promises);
};

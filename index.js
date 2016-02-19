var express = require("express"),
    app = express(),
    SphericalMercator = require('sphericalmercator'),
    sm = new SphericalMercator({ size: 256 }),
    mapnik = require('mapnik'),
    pg = require('pg'),
    squel = require('squel').useFlavour('postgres'),
    config = require('./config'),
    zlib = require('zlib');

mapnik.register_default_input_plugins();

// Format SQL
function formatSQL(table, geom_column, srid, columns, bbox) {
  var sql= squel.select()
      .field('row_to_json(fc)')
      .from(
        squel.select()
          .field("'FeatureCollection' As type")
          .field("array_to_json(array_agg(f)) As features")
          .from(
            squel.select()
              .field("'Feature' As type")
              .field("ST_AsGeoJSON(ST_transform(lg." + geom_column + ", 4326), 6)::json As geometry")
              .field("row_to_json((SELECT l FROM (SELECT " + columns.join(',') + ") As l)) As properties")
              .from(table + " As lg")
              .where("lg." + geom_column + " && ST_Transform(ST_MakeEnvelope(" + bbox.join(',') + ", 4326), " + srid + ")")
          , 'f')
      , 'fc');

  return sql.toString();
}

// Fetch GeoJSON
function fetchGeoJSON(conn, sql, vtile, res, req) {
  pg.connect(conn, function(err, client, done) {
    if (err) {
      reply({'error': 'error fetching client from pool', 'error_details': err });
    } else {
      client.query(sql, function(err, result) {
        done();  // call done to release the connection back to the pool
        if (err) {
          res.set({"Content-Type": "text/plain"});
          res.status(404).send('Tile rendering error: ' + err + '\n');
        } else {
          vtile.addGeoJSON(JSON.stringify(result.rows[0].row_to_json), req.params.table);
          zlib.gzip(vtile.getDataSync(), function(err, pbf) {
            if (err) {
              res.set({"Content-Type": "text/plain"});
              res.status(404).send('Tile rendering error: ' + err + '\n');
            } else {  
              res.set({'Content-Encoding': 'gzip', 
                  'Content-Type': 'application/x-protobuf',
                  'Access-Control-Allow-Origin': '*',
                  'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept'
              });
              res.send(pbf);
            }
          });
        }
      });
    }
  });
}

// Translate ZXY to BBOX
function returnBBOX(z, x, y) {
  return sm.bbox(x, y, z)
}

// Tile canon
app.get('/:table/:z/:x/:y.pbf', function(req, res) {
  if (config.layers[req.params.table].maxzoom >= parseInt(req.params.z)) {
    var bbox = returnBBOX(req.params.z, req.params.x, req.params.y);
    var vtile = new mapnik.VectorTile(parseInt(req.params.z, 10), parseInt(req.params.x, 10), parseInt(req.params.y));
    var sql = formatSQL(config.layers["parcels"].table, config.layers["parcels"].geom_column, config.layers["parcels"].srid, config.layers["parcels"].property_columns, bbox);
    fetchGeoJSON(config.postgis, sql, vtile, res, req);
  } else {
    res.set({"Content-Type": "text/plain"});
    res.status(404).send('Tile rendering error: this layer does not do tiles less than zoom level ' + config.layers[req.params.table].maxzoom);
  }
});


// Start server
console.log('Listening on port: ' + config.port);
app.listen(config.port);

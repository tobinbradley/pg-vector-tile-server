var Hapi = require('hapi'),
    server =  new Hapi.Server(),
    SphericalMercator = require('sphericalmercator'),
    sm = new SphericalMercator({ size: 256 }),
    mapnik = require('mapnik'),
    pg = require('pg'),
    squel = require('squel').useFlavour('postgres'),
    d3 = require('d3-queue'),
    config = require('./config'),
    zlib = require('zlib');


mapnik.register_default_input_plugins();
server.connection({
  host: 'localhost',
  port: config.port,
  routes: {
    cors: true
  }
});

// Format SQL
function formatSQL(table, geom_column, columns, bbox) {
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
              .where("lg." + geom_column + " && ST_Transform(ST_MakeEnvelope(" + bbox.join(',') + ", 4326), find_srid('', '" + table + "', '" + geom_column + "'))")
              .limit(5000)
          , 'f')
      , 'fc');

  return sql.toString();
}

// Fetch GeoJSON
function fetchGeoJSON(conn, sql, callback) {
  pg.connect(conn, function(err, client, done) {
    if (err) {
      callback(null, 'Error fetching client from pool.');
    } else {
      client.query(sql, function(err, result) {
        done();  // call done to release the connection back to the pool
        if (err) {
          callback(null, 'SQL Error: ' + err + '\n');
        } else {
          callback(null, result.rows[0].row_to_json);
        }
      });
    }
  });
}

// Get list of layers
server.route({
  method: 'GET',
  path: '/list',
  handler: function (request, reply) {
    var theList = '';
    for (var key in config.layers) {
      theList += key + ' minzoom:' + config.layers[key].minzoom + ' maxzoom:' + config.layers[key].maxzoom + '\n';
    }
    reply(theList);
  }
});

// Tile canon
server.route({
    method: 'GET',
    path: '/{table}/{z}/{x}/{y}.pbf',
    handler: function (request, reply) {
      if (config.layers[request.params.table]) {
        if (config.layers[request.params.table].maxzoom >= parseInt(request.params.z) && config.layers[request.params.table].minzoom <= parseInt(request.params.z)) {
          var bbox = sm.bbox(request.params.x, request.params.y, request.params.z);
          var vtile = new mapnik.VectorTile(parseInt(request.params.z, 10), parseInt(request.params.x, 10), parseInt(request.params.y));
          var sql = formatSQL(config.layers["parcels"].table, config.layers["parcels"].geom_column,  config.layers["parcels"].property_columns, bbox);
          //fetchGeoJSON(config.postgis, sql, vtile, reply, request);
          var q = d3.queue();
          q.defer(fetchGeoJSON, config.postgis, sql);
          q.await(function(error, GeoJSON) {
            if (typeof GeoJSON == 'object') {
              vtile.addGeoJSON(JSON.stringify(GeoJSON), request.params.table);
              zlib.gzip(vtile.getDataSync(), function(err, pbf) {
                reply(pbf)
                  .header('Content-Type', 'application/x-protobuf')
                  .header('Content-Encoding', 'gzip')
                  .header('Cache-Control', config.cache);
              });
            } else {
              reply(GeoJSON);
            }
          });
        } else {
          reply('Tile rendering error: this layer does not do tiles less than zoom level ' + config.layers[request.params.table].maxzoom);
        }
      } else {
        reply('Tile rendering error: this layer has no configuration.');
      }
    }
});

// Unleash the hounds
server.start(function(){
  console.log('Server running at:', server.info.uri);
});

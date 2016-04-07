var Hapi = require('hapi'),
    server = new Hapi.Server(),
    SphericalMercator = require('sphericalmercator'),
    sm = new SphericalMercator({
        size: 256
    }),
    pg = require('pg'),
    squel = require('squel').useFlavour('postgres'),
    d3 = require('d3-queue'),
    fs = require('fs'),
    config = JSON.parse(fs.readFileSync('config.json', 'utf8')),
    zlib = require('zlib'),
    chokidar = require('chokidar'),
    vtpbf = require('vt-pbf'),
    geojsonVt = require('geojson-vt');


server.connection({
    host: 'localhost',
    port: config.port,
    routes: {
        cors: true
    }
});


// reload config file if it changes
chokidar.watch('config.json').on('change', (event, path) => {
    config = JSON.parse(fs.readFileSync('config.json', 'utf8'))
});

// Format SQL
function formatSQL(table, geom_column, columns, bbox, simplify) {
  var sql= squel.select()
      .field('row_to_json(fc)')
      .from(
        squel.select()
          .field("'FeatureCollection' As type")
          .field("array_to_json(array_agg(f)) As features")
          .from(
            squel.select()
              .field("'Feature' As type")
              .field(`ST_AsGeoJSON(ST_transform(ST_Simplify(lg.${geom_column}, ${simplify}), 4326), 6)::json As geometry`)
              .field(`row_to_json((SELECT l FROM (SELECT ${columns.join(',')} ) As l)) As properties`)
              .from(`${table} As lg`)
              .where(`lg.${geom_column} && ST_Transform(ST_MakeEnvelope(${bbox.join(',')} , 4326), find_srid('', '${table}', '${geom_column}'))`)
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
                done(); // call done to release the connection back to the pool
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
    handler: function(request, reply) {
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
    handler: function(request, reply) {
        if (config.layers[request.params.table]) {
            if (config.layers[request.params.table].maxzoom >= parseInt(request.params.z) && config.layers[request.params.table].minzoom <= parseInt(request.params.z)) {
                var sql = formatSQL(config.layers[request.params.table].table, config.layers["parcels"].geom_column, config.layers["parcels"].property_columns, sm.bbox(request.params.x, request.params.y, request.params.z), config.layers["parcels"].simplify);
                var q = d3.queue();
                q.defer(fetchGeoJSON, config.postgis, sql);
                q.await(function(error, GeoJSON) {
                    if (typeof GeoJSON == 'object') {
                        var tileindex = geojsonVt(GeoJSON);
                        var tile = tileindex.getTile(parseInt(request.params.z, 10), parseInt(request.params.x, 10), parseInt(request.params.y));
                        // pass in an object mapping layername -> tile object
                        var buff = vtpbf.fromGeojsonVt({
                            [request.params.table]: tile
                        });
                        zlib.gzip(buff, function(err, pbf) {
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
server.start(function() {
    console.log('Server running at:', server.info.uri);
});

# PostGIS Vector Tile server

PostGIS to Mapbox vector tiles (pbf) using the [vt-pbf](https://github.com/anandthakker/vt-pbf) and [geojson-vt](https://github.com/mapbox/geojson-vt) libraries.

Credit to [Frank Rowe](http://frankrowe.org/posts/2015/03/17/postgis-to-protobuf.html) for the original idea.

To get going:

``` bash
npm install
```

Rename `config.js.txt` to `config.js` and edit the layers and Postgres connection info.

``` bash
node .
```

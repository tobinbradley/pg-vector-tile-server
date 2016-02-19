# PostGIS Vector Tile server

This thing is still very rough. Don't put it in production unless you're about to go out of town.

Credit to [Frank Rowe](http://frankrowe.org/posts/2015/03/17/postgis-to-protobuf.html) for the inspiration and basic code structure.

Note that to install this on Windows you'll need [Visual C++ Redistributable Packages for Visual Studio 2015](https://github.com/mapnik/node-mapnik#windows-specific).

To get going:

``` bash
npm install
```

Rename `config.js.txt` to `config.js` and edit the layers and Postgres connection info.

``` bash
node .
```

const path = require('path');

module.exports = {
  entry: {
    transactionSpammer: './src/iota.transactionSpammer.js'
  },
  module: {
    loaders: [
      {
        test: /\.js$/,
        exclude: /(node_modules|bower_components)/,
      }
    ],
  },
  output: {
    path: __dirname + "/dist",
    publicPath: '/dist',
    filename: '[name].min.js',
    chunkFilename: '[id].bundle.js'
  }
};

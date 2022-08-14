'use strict';

const withDefaults = require('../shared.webpack.config');
const path = require('path');

module.exports = withDefaults({
	context: path.join(__dirname),
	entry: {
		server: './src/server.ts',
		indexer: './src/Documents/DocumentsIndexer.ts'
	},
	resolve: {
		symlinks: false
	},
	output: {
		filename: '[name].js',
		path: path.join(__dirname, 'out')
	}
});

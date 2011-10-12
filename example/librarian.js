/*
 * A simple little script to test things out
 *
 * Run indexEverything() to index all the poems in the texts/ dir
 * Then use the search function
 *
 * Example:
 *
 *      $ node
 *      > var librarian = require("./librarian");
 *      > librarian.indexEverything();
 *      // wait for deferred calls to finish ...
 *
 *      > librarian.search("flower");
 *      36 matches found
 *      1 ms elapsed
 *      Best match:
 *      32-Emily Dickinson-VII.
 *
 *
 *      VII.
 *
 *      WITH A FLOWER.
 *
 *      I hide myself within my flower,
 *      That wearing on your breast,
 *      You, unsuspecting, wear me too --
 *      And angels know the rest.
 *
 *      I hide myself within my flower,
 *      That, fading from your vase,
 *      You, unsuspecting, feel for me
 *      Almost a loneliness.
 *
 *
 */
var collector = require("../collector");
var redis = require("redis").createClient();

var fs = require('fs');

var poets = {
  'Emily Dickinson': [
      'emily-dickinson-life.txt',
      'emily-dickinson-love.txt',
      'emily-dickinson-nature.txt'
    ],
  'Oscar Wilde': [
      'oscar-wilde.txt'
    ],
  'Robert Browning': [
      'robert-browning.txt'
    ],
  'William Blake': [
      'william-blake.txt'
    ]
};

module.exports.indexEverything = function() {
  var iter = 0;
  for (var poet in poets) {
    for (var i in poets[poet]) {

      // Read each file, splitting it into poems
      var file = fs.readFileSync('texts/'+poets[poet][i]).toString();
      var poems = file.split('\n\n\n\n');
      
      // for each poem ...
      for (var i in poems) {
        iter += 1;

        try {
          var text = poems[i];

          // treat the first line as the title ...
          var title = text.match(/\w+.*/)[0];

          // build a unique id for it ...
          var id = iter + '-' + poet + '-' + title;

          // store it ...
          redis.set(id, text);

          // and index it for searching ...
          collector.indexDocument(id, text, console.log);


        } catch (err) {
          // there will be some blobs of whitespace to ignore
        }
      }
    }
  }
};

module.exports.search = function(query) {
  var start = new Date();
  collector.search(query, function(err, ids) {
    var end = new Date();
    if (!err && ids.length > 0) {
      redis.get(ids[0], function(err, text) {
        console.log("%d matches found", ids.length);
        console.log((end-start) + ' ms elapsed');
        console.log("Best match:");
        console.log(ids[0]);
        console.log(text);
      });
    } else if (err) {
      console.error(err);
    } else {
      console.log("No results");
    }
  });
}

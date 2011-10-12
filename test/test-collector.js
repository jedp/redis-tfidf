// Run me with nodeunit

var _ = require('underscore');
var config = require('../config');

var collector = require('../collector');

// Use the collector's redis instance in the tests
var r = collector.r;

var doc1 = {id:1, text:"I like pie."};
var doc2 = {id:2, text:"I like potatoes."};
var doc3 = {id:3, text:"I have an irrational love, yes I do, of flan."};
var doc4 = {id:4, text:"I like pie and potatoes."};

var testCase = require('nodeunit').testCase;
var test_db = config.redisTestDatabase;

module.exports = testCase({
  setUp: function (callback) {
      collector.selectRedisDatabase(test_db, function(err, ok) {
        if (err) callback(err);
        r.flushdb(function (err, ok) {
          // index our three documents
          collector.indexDocument(doc1.id, doc1.text, function() {
            collector.indexDocument(doc2.id, doc2.text, function() {
              collector.indexDocument(doc3.id, doc3.text, callback);
            });
          });
        });
      });
  },
  tearDown: function (callback) {
    r.flushdb(callback);
  },

  testN: function (test) {
    // there should be three documents now
    test.expect(1);
    r.get('N', function(err, n) {
      test.equal(n, 3);
    });
    test.done();
  },

  testStoreTerms: function(test) {
    // terms for each document have been recorded
    test.expect(1);
    r.smembers('dt:1', function(err, results) {
      test.ok(!err && results.length===3);
      test.done();
    });
  },

  testTF: function(test) {
    // frequency of terms is correct
    test.expect(4);

    // Occurs once in doc1
    r.zscore('tf:i', 1, function(err, score) {
      test.equal(score, 1);
    });

    // Occurs twice in doc3
    r.zscore('tf:i', 3, function(err, score) {
      test.equal(score, 2);
    });

    // A stemmed word
    r.zscore('tf:irrat', 3, function(err, score) {
      test.equal(score, 1);
    });

    // An unstemmed word that should not be in there
    r.zscore('tf:irrational', 3, function(err, score) {
      test.equal(score, null);
    });

    test.done();
  },

  testDF: function(test) {
    // check document (overall) frequency for terms
    test.expect(3);

    // 'i' is in three documents
    r.zcard('df:i', function(err, count) {
      test.equal(count, 3);
    });

    // 'pie' is in one document
    r.zcard('df:pie', function(err, count) {
      test.equal(count, 1);
    });

    // 'glug' is in no documents
    r.zcard('df:glug', function(err, count) {
      test.equal(count, 0);
    });

    test.done();

  },

  testLEN: function(test) { 
    // we know how many terms there are for each document
    test.expect(3);

    r.zscore('l', 1, function(err, score) {
      test.equal(score, 3);
    });

    r.zscore('l', 2, function(err, score) {
      test.equal(score, 3);
    });

    r.zscore('l', 3, function(err, score) {
      test.equal(score, 10);
    });
    
    test.done();
  },

  testTERMS: function(test) {
    // we should have a correct list of terms
    test.expect(1);

    r.smembers('ts', function(err, terms) {
      // Terms should be:
      // [ 'an', 'do', 'flan', 'have',
      //   'i', 'irrat', 'like', 'love',
      //  'of', 'pie', 'potato', 'ye' ]
      test.equal(terms.length, 12);
    });

    test.done();
  },

  testWEIGHT: function(test) {
    // test relative weights
    test.expect(2);

    r.zscore('w:flan', 3, function(err, wgt) {
      // some number
      test.ok(wgt > 0);
    });

    r.zscore('w:flan', 1, function(err, wgt) {
      // null
      test.ok(!wgt);
    });

    test.done();
  },

  testIDS: function(test) {
    test.expect(1);
    r.smembers('ids', function(err, ids) { 
      test.ok(ids.length === 3);
      test.done();
    });
  },

  testSearch: function(test) {
    test.expect(1);
    
    collector.search("i wanna potato!", function(err, results) {
      test.ok(results[0] == 2);
      test.done();
    });

  },

  testRemoveOne: function(test) {
    test.expect(1);
    collector.removeDocument(3, function(err) {
      collector.search('flan', function(err, results) {
        test.ok(!err && !results.count);
        test.done();
      });
    });
  }

});


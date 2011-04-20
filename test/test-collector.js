var _ = require('underscore');
var r = require('redis').createClient();
var collector = require('../collector');

var doc1 = {id:1, text:"I like pie."};
var doc2 = {id:2, text:"I like potatoes."};
var doc3 = {id:3, text:"I have an irrational love, yes I do, of flan."};

var testCase = require('nodeunit').testCase;
var test_db = '_test_tfidf';

module.exports = testCase({
  setUp: function (callback) {
      r.select(test_db, function(err, ok) {
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
    // clean up
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

  testTF: function(test) {
    // check the frequency of some terms
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
    r.smembers('df:i', function(err, members) {
      test.equal(members.length, 3);
    });

    // 'pie' is in one document
    r.smembers('df:pie', function(err, members) {
      test.equal(members.length, 1);
    });

    // 'glug' is in no documents
    r.smembers('df:glug', function(err, members) {
      test.equal(members.length, 0);
    });

    test.done();

  },

  testLEN: function(test) { 
    // we know how many terms there are for each document
    test.expect(3);

    r.zscore('len', 1, function(err, score) {
      test.equal(score, 3);
    });

    r.zscore('len', 2, function(err, score) {
      test.equal(score, 3);
    });

    r.zscore('len', 3, function(err, score) {
      test.equal(score, 10);
    });
    
    test.done();
  },

  testTERMS: function(test) {
    // we should have a correct list of terms
    test.expect(1);

    r.smembers('terms', function(err, terms) {
      // Terms should be:
      // [ 'an', 'do', 'flan', 'have',
      //   'i', 'irrat', 'like', 'love',
      //  'of', 'pie', 'potato', 'ye' ]
      test.equal(terms.length, 12);
    });

    test.done();
  },

  testWEIGHT: function(test) {
    test.equal('You must write me', 'dude');
    test.done();
  }


});



/*
 * Important variables:
 *
 * N        integer number of total documents
 * tf       zset of terms scored by frequency
 * cf       zset of terms scored by overall frequency in corpus
 * df       zset of terms scored by num docs they occur in 
 * len      zset of doc ids scored by length
 * idf      zset of terms scored by inverse document frequency
 * xedni    reverse index of documents by term
 *
 */

var N = 'N';                // key  -> int
var TF_PREFIX = 'tf:';      // zset -> { documentId, frequency }
var DF_PREFIX = 'df:';      // set  -> { documentIds }
var LEN = 'len';            // zset -> { documentId, terms }
var WGT_PREFIX = 'weight:'; // zset -> { documentId, weight }
var TERMS = 'terms'         // set  -> { term }

var _ = require('underscore');

var r = require('redis').createClient();
var stemmer = require('./lib/porter-stemmer/porter').stemmer;

calculateWeight = function (id, term, callback) {
  // For a given term and document id, calculate the 
  // importance, or weight, of that term according to
  // its frequency in the document against the overall
  // frequency of the term across the corpus.
  //
  // Basically, this means that a term that's really 
  // frequent in a document but infrequent across the 
  // corpus will be scored more highly than a term 
  // that's more common overall.
  //
  // Returns a float >= 0.0
  
  r.zscore(TF_PREFIX+term, id, function (err, tf) {
    if (err) return callback ('in getTF: ' + err);
    if (tf === 0) { 
      // term is not in corpus. no score for you.
      return callback(null, 0.0);
    } else {
      r.zscore(LEN, id, function (err, len) {
        if (err) return callback ('in getLEN: ' + err);
        // proportional term frequency for document
        var tfd = (tf / len) + 1.0;
        r.get(N, function (err, n) {
          if (err) return callback ('in getN: ' + err);
          r.scard(DF_PREFIX+term, function (err, df) {
            if (err) return callback ('in getDF: ' + err);
            // inverse overall document frequency for term
            var idf = n / df;
            var wgt = 1 + Math.log(tfd) * Math.log(idf);
            // record weight for this term/doc
            r.zadd(WGT_PREFIX+term, wgt, id, function(err, success) {
              if (err) return callback ('in ZADD wgt: ' + err);
              return callback (null, wgt);
            });
          });
        });
      });
    }
  });
}

exports.calculateWeights = calculateWeights = function(id, termList, callback) {
  var iter = 0;
  var totalTerms = termList.length;
  _.each(termList, function(t) {
    calculateWeight(id, t, function(err, wgt) {
      iter ++;
      if (err) {
        return callback('calc weights: ' + err);
      } 
      if (iter === totalTerms)  {
        return callback (null);
      } 
      
    });
  });
}

calculateDocumentFrequency = function(id, termList, callback) {
  // increment document frequency for each term.
  // Each term is registered as a set (tf:term), and 
  // the document id is added to that set. 
  //
  // So the cardinality of each set is the document frequency,
  // and the members of the set can guide us back to the original
  // documents.
  //
  // In this way, the document-frequency sets also serve as 
  // a reverse-index, associating all terms with the documents
  // the occur in.
  var iter = 0;
  var totalTerms = termList.length;
  _.each(termList, function(t) {
    r.sadd(DF_PREFIX+t, id, function(err, success) {
      iter ++;
      if (err) { 
        return callback(err);
      }
      // after processing each term, move on
      if (iter === totalTerms) {
        //return calculateWeights(id, termList, callback);
        return callback(null);
      }
    });
  });
}

calculateTermFrequency = function(id, terms, callback) {
  // Accumulate frequency for terms in each document
  var counts = {};
  var termList = [];
  var numTerms = 0;

  // Count occurrence of each term here
  _.map(terms, function(t) { 
    // strip non-word stuff
    if (!counts[t]) {
      numTerms ++;
      termList.push(t);
      counts[t] = 0;
    }
    counts[t] += 1;
  });

  // And then tell redis
  var iter = 0;
  _.each(termList, function(t) {
    // record the term, and calculate term frequency for doc
    r.sadd(TERMS, t);
    r.zincrby(TF_PREFIX+t, counts[t], id, function(err, result) {
      iter ++;
      if (err) {
        return callback(err);
      } 
      // after we have processed all the terms, move on
      if (iter === numTerms) {
        return callback(null);
      }
    });
  });
}

updateDocumentLength = function(id, terms, callback) {
  // Record the number of terms for this document
  var length = terms.length
  r.zadd(LEN, length, id, function(err, success) { 
    if (err) {
      return callback(new Error(err), null);
    } else {
      return callback(null, length);
    }
  });
}

readDocument = function(id, text, callback) {
  // Collect all terms and words in a document.
  // Remove extraneous characters and map to lower-case.
  var terms = _.map(
    text.trim().split(/\s+/),
    function(t) { return stemmer(t.replace(/\W+/g, '').toLowerCase()) });
  
  updateDocumentLength(id, terms, function(err) {
    calculateTermFrequency(id, terms, function(err) {
      calculateDocumentFrequency(id, terms, function(err) {
        calculateWeights(id, terms, function(err) {
          if (callback) return callback(err, 'yay');
        });
      });
    });
  });
}

exports.indexDocument = indexDocument = function(id, text, callback) {
  // Index a document
  r.sismember('ids', id, function(err, already_indexed) {
    if (! already_indexed ) { 
      r.incr(N, function(err, result) { 
        return readDocument(id, text, callback);
      });
    } else {
      return readDocument(id, rext, callback);
    }
  });
}




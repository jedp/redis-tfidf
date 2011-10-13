/*
 * collector.js - simple document indexing and search with redis
 *
 * Example:
 *
 * Getting an instance
 *
 * > var collector = require("./collector");
 *
 * Indexing documents 
 *
 * > collector.indexDocument(1, "I love cats; I love every kind of cat.");
 * > collector.indexDocument(2, "Sorry, I'm thinking about cats again!");
 * > collector.indexDocument(3, "Can't hug every cat.");
 * 
 * Searching for documents.  IDs are returned in order of relevance.
 * (Note: there is no synchronous version of the search function.  you
 * can't say 'ids = collector.search("something")'.)
 *
 * > collector.search("love", console.log);
 * null [ 1 ]
 * > collector.search("every", console.log);
 * null [ 3, 1 ]
 * > collector.search("cat", console.log);
 * null [ 1, 2, 3 ]
 *
 * It's up to you to store the contents of your documents somewhere and 
 * retrieve them however you like according to the IDs returned. 
 *
 */

/*
 *
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

var config = require('./config');

var N = 'N';                // key  -> int
var TF_PREFIX = 'tf:';      // zset -> { documentId, frequency }
var DF_PREFIX = 'df:';      // set  -> { documentIds }
var LEN = 'l';              // zset -> { documentId, terms }
var WGT_PREFIX = 'w:';      // zset -> { documentId, weight }
var DOCT_PREFIX = 'dt:';    // set  -> { term }
var TERMS = 'ts'            // set  -> { term }
var IDS = 'ids'             // set  -> { document Ids }

var _ = require('underscore');

var stemmer = require('porter-stemmer').memoizingStemmer;

var stopWords = {};
if (config.filterStopWords) {
  var fs = require('fs');
  var words = fs.readFileSync(__dirname+'/stop_words.txt').toString().split('\n');
  for (i in words) {
    var word = words[i].trim();
    if (word) {
      stopWords[word] = true;
    }    
  }
}

function Collector(redisClient, redisDatabase) {
  var self = this;

  self.initialize = function(callback) {
    callback = callback || function() {};

    // Create a client if none was provided
    if (redisClient) { 
      self.setRedisClient(redisClient);
    } else {
      self.setRedisClient(require("redis").createClient());
    }

    // Select redis database
    if (redisDatabase) {
      self.r.select(redisDatabase, function(err) {
        if (err) return callback (err);
        return callback(null, self);
      });
    } else {
      return callback(null, self);
    }
  };

  self.setRedisClient = function(redisClient) {
    self.r = redisClient;
    return self;
  };

  self.selectRedisDatabase = function(database, callback) {
    self.r.select(database, function(err, success) {
      if (typeof callback === 'function') {
        return callback (err, success);
      }
    });
  };

  /*
   * Utility
   *
   * stemText(string) -> [list, of, stems]
   *
   * If config.filterStopWords, stop words will be filtered out
   */

  self.stemText = function(text) {
    var words = text.trim().split(/\s+/);
    var stemmed = [];
    for (i in words) {
      var word = words[i];
      if (! stopWords[word]) {
        stemmed.push(stemmer(word.replace(/\W+/g, '').toLowerCase()));
      }
    }
    return stemmed;
  };


  /*
   * Private methods
   *
   * _calculateWeight
   * _calculateWeights
   * _calculateDocumentFrequency
   * _calculateTermFrequency
   * _updateDocumentLength
   * _storeDocumentTerms
   * _readDocument
   */

  self._calculateWeight = function (id, term, callback) {
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
    
    self.r.zscore(TF_PREFIX+term, id, function (err, tf) {
      if (err) return callback ('in getTF: ' + err);
      if (tf === 0) { 
        // term is not in corpus. no score for you.
        return callback(null, 0.0);
      } else {
        self.r.zscore(LEN, id, function (err, len) {
          if (err) return callback ('in getLEN: ' + err);
          // proportional term frequency for document
          var tfd = (tf / len) + 1.0;
          self.r.get(N, function (err, n) {
            if (err) return callback ('in getN: ' + err);
            self.r.zcard(DF_PREFIX+term, function (err, df) {
              if (err) return callback ('in getDF: ' + err);
              // inverse overall document frequency for term
              var idf = n / df;
              var wgt = 1 + Math.log(tfd) * Math.log(idf);
              // record weight for this term/doc
              self.r.zadd(WGT_PREFIX+term, wgt, id, function(err, success) {
                if (err) return callback ('in ZADD wgt: ' + err);
                return callback (null, wgt);
              });
            });
          });
        });
      }
    });
  }

  self._calculateWeights = function(id, termList, callback) {
    var iter = 0;
    var totalTerms = termList.length;
    _.each(termList, function(t) {
      self._calculateWeight(id, t, function(err, wgt) {
        iter ++;
        if (err) {
          return callback('calc weights: ' + err);
        } 
        if (iter === totalTerms)  {
          return callback (null);
        } 
        
      });
    });
  };

  self._calculateDocumentFrequency = function(id, termList, callback) {
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
      self.r.zincrby(DF_PREFIX+t, 1, id, function(err, success) {
        iter ++;
        if (err) { 
          return callback(err);
        }
        // after processing each term, move on
        if (iter === totalTerms) {
          //return self._calculateWeights(id, termList, callback);
          return callback(null);
        }
      });
    });
  };

  self._calculateTermFrequency = function(id, terms, callback) {
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
      self.r.sadd(TERMS, t);
      self.r.zincrby(TF_PREFIX+t, counts[t], id, function(err, result) {
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
  };

  self._updateDocumentLength = function(id, terms, callback) {
    // Record the number of terms for this document
    var length = terms.length
    self.r.zadd(LEN, length, id, function(err, success) { 
      if (err) {
        return callback(new Error(err), null);
      } else {
        return callback(null, length);
      }
    });
  };

  self._storeDocumentTerms = function(id, terms, callback) {
    var iter = 0;
    var numTerms = terms.length;
    _.each(terms, function(t) {
      self.r.sadd(DOCT_PREFIX+id, t, function(err) {
        iter ++;
        if (err) return callback(err);
        if (iter === numTerms ) {
          callback(null, numTerms);
        }
      });
    });
  };

  self._readDocument = function(id, text, callback) {
    // Collect all terms and words in a document.
    // Remove extraneous characters and map to lower-case.
    var terms = self.stemText(text);
    
    self._updateDocumentLength(id, terms, function(err) {
      self._storeDocumentTerms(id, terms, function(err) {
        self._calculateTermFrequency(id, terms, function(err) {
          self._calculateDocumentFrequency(id, terms, function(err) {
            self._calculateWeights(id, terms, function(err) {
              if (callback) return callback(err, 'read document with id ' + id);
            });
          });
        });
      });
    });
  }

  /*
   * public methods
   *
   * removeDocument
   * indexDocument
   * search
   */

  self.removeDocument = function(id, callback) {
    callback = callback || console.log;
    self.r.sismember(IDS, id, function(err, exists) {
      if (err) {
        return callback (err);
      } else if (!exists) {
        callback ('no such document');
      } else {
        self.r.decr(N, function(err) {
          if (err) return callback(err);
          self.r.smembers(DOCT_PREFIX+id, function(err, terms) {
            if (err) callback(err);

            // remove doct: record
            self.r.del(DOCT_PREFIX+id);

            var iter = 0;
            _.each(terms, function(term) {
              self.r.zscore(DF_PREFIX+term, id, function(err, df) {
                if (err) callback(err);
                self.r.zscore(TF_PREFIX+term, id, function(err, tf) { 
                  self.r.zadd(TF_PREFIX+term, tf-df, id, function(err) {
                    if (err) callback(err);
                    self.r.zrem(DF_PREFIX+term, id, function(err) {     
                      if (err) callback(err);
                      self.r.zrem(WGT_PREFIX+term, id, function(err) {     
                        iter ++;
                        if (iter===terms.length) callback(err);
                      }); 
                    });
                  });
                });     
              });
            });
          });
        });
      }
    });
  };

  self.indexDocument = function(id, text, callback) {
    // Index a document
    callback = callback || function(err) {
      if (err) { 
        console.error("error indexing document %j:\n%j", id, err);
      }
    };
    self.r.sismember(IDS, id, function(err, exists) {
      if (! exists ) { 
        self.r.incr(N, function(err) { 
          self.r.sadd(IDS, id, function(err) {
            if (err) return callback(err);
            return self._readDocument(id, text, callback);
          });
        });
      } else {
        return self._readDocument(id, text, callback);
      }
    });
  };

  self.search = function(phrase, callback) {
    // find the documents that are the best fit for phrase
    callback = callback || function(err, ids) {
      if (err) {
        console.log("search returned error: %j", err);
      } else {
        console.log("search returned ids: %j", ids);
      }
    };
    var terms = self.stemText(phrase);
    var scores = {};
    var iter = 0;
    var ids = [];
    _.each(terms, function(term) {
      self.r.zrangebyscore(WGT_PREFIX+term, 0, 10, 'WITHSCORES', function(err, members) {
        if (err) return callback (err);

        iter ++;

        // process pairwise members: id, score, id, score, ...
        while (members.length) {
          var id = members.shift();
          var score = parseFloat(members.shift(), 10);
          scores[id] = (scores[id] ? scores[id] : 0) + score;
          if (ids.indexOf(id) < 0) {
            ids.push(id);
          }
        }

        if (iter == terms.length) {
          // sort ids by score, descending
          ids = ids.sort( function(a, b) { return scores[b] - scores[a] });

          return callback(null, ids);
        }
      });
    });
  };

  return self.initialize(function() { return self });
};

module.exports = new Collector(
  require("redis").createClient(config.redisPort, config.redisHost),
  config.redisDatabase
);


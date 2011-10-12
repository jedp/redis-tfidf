redis-tfidf
===========

The Term-Frequency/Inverse-Document-Frequency IR algorithm 
implemented using redis.

Indexing documents
------------------

Assume we have a collection of documents, each with its own
unique identifier.  We supply the identifier and the document
text to the collector:

    $ node
    > var collector = require("./collector");
    > collector.indexDocument(1, "I love cats; I love every kind of cat.");
    > collector.indexDocument(2, "Sorry, I'm thinking about cats again!");
    > collector.indexDocument(3, "Can't hug every cat.");

As documents are indexes, words are tokenized using the Porter stemmer.
More about that HERE.
 
Searching for Documents
-----------------------

For a given query, document IDs for matching documents are returned in order of
relevance.

Note that there is no synchronous version of the search function.  You have to 
use a callback to do anything with search results.

    > collector.search("love", console.log);
    null [ 1 ]
    > collector.search("every", console.log);
    null [ 3, 1 ]
    > collector.search("cat", console.log);
    null [ 1, 2, 3 ]

As with indexing, query terms are stemmed.  So for example:

    > collector.search("hugging cats", console.log);
    null [ 3, 1, 2 ]

Document 3 is the best match for "hugging cats", since it contains "cat" and
"hug".  The other two documents are returned because they are about cats,
though they're short on hugging.










/*

  ## Stats

  A paginated table of events matching a piped stats query
  
  ### Parameters
  * query ::  A string representing then current query
  * size :: Number of events per page to show
  * pages :: Number of pages to show. size * pages = number of cached events. 
             Bigger = more memory usage byh the browser
  * offset :: Position from which to start in the array of hits
  * sort :: An array with 2 elements. sort[0]: field, sort[1]: direction ('asc' or 'desc')
  * style :: hash of css properties
  * fields :: columns to show in table
  * overflow :: 'height' or 'min-height' controls wether the row will expand (min-height) to
                to fit the table, or if the table will scroll to fit the row (height) 
  * sortable :: Allow sorting?
  * spyable :: Show the 'eye' icon that reveals the last ES query for this panel
  ### Group Events
  #### Sends
  * None
  #### Receives
  * time :: An object containing the time range to use and the index(es) to query
  * query :: An Array of queries, even if its only one
*/

//TODO: Update comments as per stats table implementation and remove commented code  

angular.module('kibana.stats', [])
.controller('stats', function($scope, eventBus, fields) {

  // Set and populate defaults
  var _d = {
    query   : "*",
    size    : 100, // Per page
    pages   : 5,   // Pages available
    offset  : 0,
    sort    : [],
    group   : "default",
    style   : {'font-size': '9pt'},
    overflow: 'height',
    fields  : [],
    sortable: true,
    header  : true,
    paging  : true, 
    spyable: true
  }
  _.defaults($scope.panel,_d);

  //Check if query is sent from URL and modify panel query accordingly
  if($.queryFromURL)
      $scope.panel.query = $.queryFromURL;

  $scope.init = function () {

    $scope.set_listeners($scope.panel.group);

    // Now that we're all setup, request the time from our group
    eventBus.broadcast($scope.$id,$scope.panel.group,"get_time");
  }

  $scope.set_listeners = function(group) {
    eventBus.register($scope,'time',function(event,time) {
      $scope.panel.offset = 0;      
      set_time(time)
    });
    eventBus.register($scope,'query',function(event,query) {
      $scope.panel.offset = 0;
      $scope.panel.query = _.isArray(query) ? query[0] : query;
      $scope.get_data();
    });
  }

  $scope.set_sort = function(field) {
    $scope.panel.error = "";
        
    if($scope.panel.sort[0] === field)
      $scope.panel.sort[1] = $scope.panel.sort[1] == 'asc' ? 'desc' : 'asc';
    else
      $scope.panel.sort[0] = field;

    if(!$scope.panel.sort[1])
         $scope.panel.sort[1] = 'asc';

    // Sort the data
    $scope.data = _.sortBy($scope.data, function(v){
        return v._source[$scope.panel.sort[0]]
    });
    
    // Reverse if needed
    if($scope.panel.sort[1] == 'desc')
        $scope.data.reverse();
  }

  $scope.page = function(page) {
    $scope.panel.offset = page*$scope.panel.size
    $scope.get_data();
  }

  $scope.get_data = function(segment,query_id) {
    $scope.panel.error =  false;    
                
    // Make sure we have everything for the request to complete
    if(_.isUndefined($scope.index) || _.isUndefined($scope.time))
      return
    
    $scope.panel.loading = true;

    var _segment = _.isUndefined(segment) ? 0 : segment
    $scope.segment = _segment;    
    
    var oScript = {}, request = $scope.ejs.Request().indices($scope.index[_segment]).size(0);
    
    //Split the user input into query and script calls
    var splitQueryArray =  splitQuery($scope.panel.query);

    //Valid pipe found, extract the arguments into oScript
    if(splitQueryArray.length > 1){
        for(var index = 1; index < splitQueryArray.length; index++){
            getArguments(splitQueryArray[index], oScript);        
    
            //Handle various script calls
            if(oScript.script && oScript.script === 'stats')
            {     
                //Keeps track of the columns on which this facet is called
                //If multiple aggregates have the same column, we might as well just call the facet once
                var existingFacets = {}, facetCount = 0;
                var filteredQuery, facet, modifiedQuery;
                
                //Build the facets query from the user supplied aggregates
                _.each(oScript.aggregates, function(aggregate){     
                    //Only useful for count aggregate, when a sub query is supplied
                    if(aggregate.hasOwnProperty("query"))
                        modifiedQuery = (splitQueryArray[0] || '*') + " AND " + aggregate.query;
                    else
                        modifiedQuery = (splitQueryArray[0] || '*');
                       
                    filteredQuery = $scope.ejs.FilteredQuery(
                                        ejs.QueryStringQuery(modifiedQuery),
                                        ejs.RangeFilter($scope.time.field)
                                          .from($scope.time.from)
                                          .to($scope.time.to));
                                              
                    if(aggregate.type === "count"){
                        facet = $scope.ejs.TermsFacet( aggregate.alias || aggregate.query || "count")
                                    .field(oScript.field)
                                    .size($scope.panel.size*$scope.panel.pages)
                                    .facetFilter($scope.ejs.QueryFilter(filteredQuery));
                                    
                        aggregate.facetName = aggregate.alias || aggregate.query || "count";
                    }
                    else if (aggregate.type === 'min' || aggregate.type === 'max' || aggregate.type === 'avg' || aggregate.type === 'sum'){
                        //Check if there is an aggregate facet on the same column
                        if(!existingFacets.hasOwnProperty(aggregate.column)){
                            existingFacets[aggregate.column] = "term_stats_" + facetCount++;
                            facet = $scope.ejs.TermStatsFacet(existingFacets[aggregate.column])
                                        .keyField(oScript.field)
                                        .valueField(aggregate.column)
                                        .size($scope.panel.size*$scope.panel.pages)
                                        .facetFilter($scope.ejs.QueryFilter(filteredQuery));                    
                        }
                        
                        //Set the name for the facet so as to extract appropriate value when processing ElasticSearch results
                        aggregate.facetName = existingFacets[aggregate.column];
                        
                        aggregate.displayName = aggregate.alias || aggregate.type;
                    }                            
                    
                    request = request.facet(facet);
                });
                
                break;
            }
        }
    }

    if(oScript.script && oScript.script === 'stats'){
        $scope.populate_modal(request);
    
        var results = request.doSearch()
    
        // Populate scope when we have results
        results.then(function(results) {
          $scope.panel.loading = false;
          $scope.panel.fields.length = 0;
    
          if(_segment === 0) {
            // $scope.hits = 0;
            $scope.data = [];
            query_id = $scope.query_id = new Date().getTime()
          }
    
          // Check for error and abort if found
          if(!(_.isUndefined(results.error))) {
            $scope.panel.error = $scope.parse_error(results.error);
            return;
          }
    
          // Check that we're still on the same query, if not stop
          if($scope.query_id === query_id) {
            
            var facetTerms = {}, facetValue, termType, facetName;
            $scope.panel.fields.push(oScript.field);
            
            _.each(oScript.aggregates, function(aggregate){
                facetValue = results.facets[aggregate.facetName];
                facetName = aggregate.displayName || aggregate.facetName;
                
                $scope.panel.fields.push(facetName);
                
                //Type will be used to extract appropriate value from the term in terms_stats facet
                if(aggregate.type === "count")
                    termType = "count";
                else if(aggregate.type === "max")
                    termType = "max";
                else if(aggregate.type === "min")
                    termType = "min";
                else if(aggregate.type === "avg")
                    termType = "mean";
                else if(aggregate.type === "sum")
                    termType = "total";
                        
                _.each(facetValue.terms, function(termMember){
                    if(!facetTerms.hasOwnProperty(termMember.term)){
                        //Storing a redundant copy for the term so that we maintain the datatype
                        //Datatype is cast to string when it's an object's property
                        facetTerms[termMember.term] = {};
                        facetTerms[termMember.term]["term"] = termMember.term;
                    }
                      
                    facetTerms[termMember.term][facetName] = termMember[termType];
                });
            });        
            
            $scope.data= $scope.data.concat(_.map(facetTerms, function(value) {
              var returnObject = {};
              returnObject[$scope.panel.fields[0]] = value.term;
              
              for(var fieldIndex = 1; fieldIndex < $scope.panel.fields.length; fieldIndex++){
                if(value.hasOwnProperty($scope.panel.fields[fieldIndex]))
                    returnObject[$scope.panel.fields[fieldIndex]] = value[$scope.panel.fields[fieldIndex]];
                else
                    returnObject[$scope.panel.fields[fieldIndex]] = 0;
              }
                
              return {
                 _source   : returnObject
              }
            }));
            
            // Sort the data
            $scope.data = _.sortBy($scope.data, function(v){
              return v._source[$scope.panel.sort[0]]
            });
            
            // Reverse if needed
            if($scope.panel.sort[1] == 'desc')
              $scope.data.reverse();
            
            // Keep only what we need for the set
            $scope.data = $scope.data.slice(0,$scope.panel.size * $scope.panel.pages);
          } else {
            return;
          }      
        });
    }
    else{
        $scope.panel.loading = false;
        $scope.data = [];
        $scope.panel.fields.length = 0;
    }
  }

  $scope.populate_modal = function(request) {
    $scope.modal = {
      title: "Table Inspector",
      body : "<h5>Last Elasticsearch Query</h5><pre>"+
          'curl -XGET '+config.elasticsearch+'/'+$scope.index+"/_search?pretty -d'\n"+
          angular.toJson(JSON.parse(request.toString()),true)+
        "'</pre>", 
    } 
  }

  $scope.without_kibana = function (row) {
    return { 
      _source   : row._source
    }
  } 

  $scope.set_refresh = function (state) { 
    $scope.refresh = state; 
  }

  $scope.close_edit = function() {
    if($scope.refresh)
      $scope.get_data();
    $scope.refresh =  false;
  }

  function set_time(time) {
    $scope.time = time;
    $scope.index = _.isUndefined(time.index) ? $scope.index : time.index
    $scope.get_data();
  }
});


function loadKibana(){
    window.location = "index.html" + (window.location.hash || '');
}

function  showContent(divID){
    $('.divContent div:visible').each(function(){
        $(this).hide();
    });
    
    $("#divContent_" + divID.split("_")[1]).show();
    
    $('.divSectionSelected').each(function(){
        $(this).removeClass('divSectionSelected');
    });
    
    $('#'+divID).addClass('divSectionSelected');
}

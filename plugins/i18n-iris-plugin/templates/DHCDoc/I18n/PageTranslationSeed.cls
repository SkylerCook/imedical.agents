/// Canonical page-level translation seed for DHCDoc projects
Class DHCDoc.I18n.PageTranslationSeed Extends DHCDoc.Util.RegisteredObject
{

/// Write one page translation. Identical values are idempotent; conflicts are rejected.
ClassMethod SetPageTrans(languageCode As %String, page As %String, item As %String, translation As %String) As %Status
{
    q:languageCode="" $$$ERROR($$$GeneralError,"languageCode is required")
    q:page="" $$$ERROR($$$GeneralError,"page is required")
    q:item="" $$$ERROR($$$GeneralError,"item is required")

    s languageId=##class(DHCDoc.GetData.CT.LG.Language).GetRowIdFromCodeDesc(languageCode,"")
    q:languageId="" $$$ERROR($$$GeneralError,"languageCode not found: "_languageCode)

    if $d(^websys.TranslationD("PAGE",languageId,page,item)) {
        q:$g(^websys.TranslationD("PAGE",languageId,page,item))=translation $$$OK
        q $$$ERROR($$$GeneralError,"page translation conflict: "_languageCode_"/"_page_"/"_item)
    }

    s ^websys.TranslationD("PAGE",languageId,page,item)=translation
    q $$$OK
}

/// Roll back one page translation only.
ClassMethod KillPageTrans(languageCode As %String, page As %String, item As %String) As %Status
{
    q:languageCode="" $$$ERROR($$$GeneralError,"languageCode is required")
    q:page="" $$$ERROR($$$GeneralError,"page is required")
    q:item="" $$$ERROR($$$GeneralError,"item is required")

    s languageId=##class(DHCDoc.GetData.CT.LG.Language).GetRowIdFromCodeDesc(languageCode,"")
    q:languageId="" $$$ERROR($$$GeneralError,"languageCode not found: "_languageCode)

    k ^websys.TranslationD("PAGE",languageId,page,item)
    q $$$OK
}

/// Aggregate English batches. Seed generation appends SaveENTranslate{YYYYMMDDNN} calls here.
ClassMethod LoadENTranslation() As %Status
{
    q $$$OK
}

/// Roll back English batches in reverse order. Seed generation appends matching Kill calls here.
ClassMethod KillENTranslation() As %Status
{
    q $$$OK
}

}

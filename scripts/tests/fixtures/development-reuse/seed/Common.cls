Class Fixture.Common Extends %RegisteredObject
{

ClassMethod Normalize(value As %String) As %String
{
    Quit $ZConvert($ZStrip(value,"<>W"),"U")
}

}
